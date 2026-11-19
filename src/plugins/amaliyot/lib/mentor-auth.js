// Mentor autentifikatsiyasi, Google OAuth va bir martalik muddatda avtomatik muzlatish
const crypto = require('node:crypto');
const db = require('../../../db/pool');
const env = require('../../../config/env');
const { audit } = require('../../../lib/audit');
const { flash } = require('../../../lib/http');

/**
 * Muddati o'tgan barcha tasdiqlangan mentorlarni PostgreSQL vaqti bo'yicha avtomatik muzlatadi.
 */
async function freezeExpiredMentors(q = db, req = null) {
  const { rows } = await q.query(
    `UPDATE amaliyot_mentorlar
        SET holat = 'muzlatilgan',
            muzlatilgan_vaqt = COALESCE(muzlatilgan_vaqt, now()),
            updated_at = now()
      WHERE holat = 'tasdiqlandi'
        AND amal_qilish_gacha IS NOT NULL
        AND amal_qilish_gacha <= now()
      RETURNING id, email, ustoz_id`,
  );
  for (const r of rows) {
    await audit({
      req,
      userId: null,
      amal: 'amaliyot.mentor_auto_freeze',
      obyekt: 'amaliyot_mentorlar',
      obyektId: r.id,
      eski: { holat: 'tasdiqlandi' },
      yangi: { holat: 'muzlatilgan', email: r.email },
    });
  }
  return rows;
}

/**
 * Har bir mentor so'rovida sessiyadan mentorni yuklaydi va faol/muzlatilmaganligini tekshiradi.
 */
async function loadMentor(req, res, next) {
  const mentorId = req.session?.mentorId;
  if (!mentorId) return next();
  try {
    await freezeExpiredMentors(db, req);
    const { rows: [m] } = await db.query(
      `SELECT m.*,
              COALESCE(k.nomi, m.korxona_nomi_kiritilgan) AS korxona_nomi,
              u.familiya || ' ' || u.ism AS ustoz_fio
         FROM amaliyot_mentorlar m
         LEFT JOIN amaliyot_korxonalar k ON k.id = m.korxona_id
         JOIN users u ON u.id = m.ustoz_id
        WHERE m.id = $1`,
      [mentorId],
    );
    if (!m || m.holat !== 'tasdiqlandi') {
      delete req.session.mentorId;
      const msg = m?.holat === 'muzlatilgan'
        ? 'Mentor akkauntining bir martalik amal qilish muddati tugagan va muzlatilgan.'
        : 'Mentor sessiyasi yakunlandi.';
      flash(req, 'err', msg);
      return req.session.save(() => {
        if (req.headers['hx-request']) {
          res.set('HX-Redirect', '/amaliyot/mentor/kirish');
          return res.status(401).end();
        }
        res.redirect('/amaliyot/mentor/kirish');
      });
    }
    req.mentor = m;
    res.locals.mentor = m;
    next();
  } catch (e) {
    next(e);
  }
}

function requireMentor(req, res, next) {
  if (!req.mentor) {
    if (req.headers['hx-request']) {
      res.set('HX-Redirect', '/amaliyot/mentor/kirish');
      return res.status(401).end();
    }
    return res.redirect('/amaliyot/mentor/kirish');
  }
  next();
}

function isGoogleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function googleCallbackUrl(req) {
  const base = (env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/amaliyot/mentor/google/callback`;
}

function createGoogleAuthUrl(req) {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.amaliyotOauthState = state;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleCallbackUrl(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function fetchGoogleUser(req, code) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleCallbackUrl(req),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error('Google OAuth token olishda xato');
  const tokenData = await tokenRes.json();

  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) throw new Error('Google profil ma\'lumotlarini olishda xato');
  const profile = await userRes.json();
  if (!profile.email || !profile.sub) throw new Error('Google akkaunt emaili topilmadi');
  return {
    sub: String(profile.sub),
    email: String(profile.email).trim().toLowerCase(),
    ism: String(profile.given_name || profile.name || 'Mentor').slice(0, 100),
    familiya: String(profile.family_name || 'Korxona').slice(0, 100),
  };
}

module.exports = {
  freezeExpiredMentors,
  loadMentor,
  requireMentor,
  isGoogleOAuthConfigured,
  createGoogleAuthUrl,
  fetchGoogleUser,
};
