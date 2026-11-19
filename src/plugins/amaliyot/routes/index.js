// Amaliyot kundaligi (amaliyot) marshrutlari: talaba, ustoz, dekanat/admin va korxona mentori
const express = require('express');
const { z } = require('zod');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { ah, flash, idParam, AppError, forbidden } = require('../../../lib/http');
const { requireRole } = require('../../../middleware/rbac');
const { today, isYmd, fmtDate } = require('../../../lib/time');
const svc = require('../services/amaliyot');
const { buildKundalikDocx, buildXulosaDocx } = require('../lib/docx');
const {
  loadMentor,
  requireMentor,
  isGoogleOAuthConfigured,
  createGoogleAuthUrl,
  fetchGoogleUser,
} = require('../lib/mentor-auth');

const HOLAT_NOMI = {
  kutilmoqda: 'Kutilmoqda',
  tasdiqlandi: 'Tasdiqlandi',
  qaytarildi: 'Qaytarildi',
  rad_etildi: 'Rad etildi',
  muzlatilgan: 'Muzlatilgan',
  faol: 'Faol',
  yakunlangan: 'Yakunlangan',
  bekor_qilingan: 'Bekor qilingan',
  qoralama: 'Qoralama',
  topshirildi: 'Topshirildi',
};

const HOLAT_CLASS = {
  kutilmoqda: 'b-kutilmoqda',
  tasdiqlandi: 'b-tasdiqlandi',
  qaytarildi: 'b-rad_etildi',
  rad_etildi: 'b-rad_etildi',
  muzlatilgan: 'b-bekor_qilindi',
  faol: 'b-tasdiqlandi',
  yakunlangan: 'b-qabul_qilindi',
  bekor_qilingan: 'b-bekor_qilindi',
  qoralama: 'b-kutilmoqda',
  topshirildi: 'b-qabul_qilindi',
};

function badgeMeta(s) {
  return { label: HOLAT_NOMI[s] || s, cls: HOLAT_CLASS[s] || 'b-kutilmoqda' };
}

function fmtTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function remainingTimeText(ts) {
  if (!ts) return '—';
  const diffMs = new Date(ts).getTime() - Date.now();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 'Muddati tugagan';
  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} kun ${hours} soat`;
  if (hours > 0) return `${hours} soat ${mins} daq`;
  return `${Math.max(1, mins)} daqiqa`;
}

function decorateKundalik(k) {
  return {
    ...k,
    sana_fmt: fmtDate(k.sana),
    ustoz_badge: badgeMeta(k.ustoz_holat),
    mentor_badge: badgeMeta(k.mentor_holat),
    can_delete: k.ustoz_holat !== 'tasdiqlandi' && k.mentor_holat !== 'tasdiqlandi',
  };
}

function decorateMentor(m) {
  return {
    ...m,
    holat_badge: badgeMeta(m.holat),
    amal_qilish_fmt: fmtTimestamp(m.amal_qilish_gacha),
    qolgan_vaqt: m.holat === 'tasdiqlandi' ? remainingTimeText(m.amal_qilish_gacha) : '—',
    is_pending: m.holat === 'kutilmoqda',
    is_active: m.holat === 'tasdiqlandi',
  };
}

function computeDiaryStats(kundaliklar) {
  let jamiSoat = 0;
  let ustozTasdiq = 0;
  let mentorTasdiq = 0;
  for (const k of kundaliklar) {
    jamiSoat += Number(k.soat || 0);
    if (k.ustoz_holat === 'tasdiqlandi') ustozTasdiq += 1;
    if (k.mentor_holat === 'tasdiqlandi') mentorTasdiq += 1;
  }
  return {
    jamiKun: kundaliklar.length,
    jamiSoat,
    ustozTasdiq,
    mentorTasdiq,
  };
}

function parseBolimlarMatn(matn) {
  return String(matn || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [title, hint] = line.split('|').map((s) => s.trim());
      return { key: `bolim_${i + 1}`, title: title || `Bo'lim ${i + 1}`, hint: hint || '' };
    });
}

function formatBolimlarMatn(bolimlarJson) {
  if (!Array.isArray(bolimlarJson)) return '';
  return bolimlarJson.map((b) => (b.hint ? `${b.title} | ${b.hint}` : b.title)).join('\n');
}

function buildBolimRows(bolimlarJson, javoblar = {}) {
  const arr = Array.isArray(bolimlarJson) ? bolimlarJson : [];
  return arr.map((sec) => ({
    key: sec.key,
    title: sec.title,
    hint: sec.hint || '',
    value: javoblar?.[sec.key] || '',
  }));
}

function sendDocx(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

function parseZod(schema, payload) {
  const r = schema.safeParse(payload);
  if (!r.success) {
    throw new AppError(r.error.issues[0]?.message || 'Ma\'lumotlar noto\'g\'ri', 400);
  }
  return r.data;
}

// ---------- Zod sxemalari ----------
const kundalikSchema = z.object({
  biriktirish_id: z.coerce.number().int().positive(),
  sana: z.string().refine(isYmd, 'Sana YYYY-MM-DD formatida bo\'lishi kerak'),
  ish_mazmuni: z.string().trim().min(5, 'Ish mazmuni kamida 5 ta belgi bo\'lsin').max(4000),
  soat: z.coerce.number().min(0.5, 'Soat kamida 0.5 bo\'lsin').max(24, 'Soat 24 dan oshmasin'),
  natija: z.string().trim().max(2000).optional().default(''),
});

const korxonaSchema = z.object({
  nomi: z.string().trim().min(2, 'Korxona nomi kamida 2 ta belgi bo\'lsin').max(200),
  manzil: z.string().trim().max(300).optional().default(''),
  stir: z.string().trim().max(20).optional().default(''),
  rahbar_fio: z.string().trim().max(150).optional().default(''),
  telefon: z.string().trim().max(30).optional().default(''),
});

const biriktirishSchema = z.object({
  student_id: z.coerce.number().int().positive('Talabani tanlang'),
  korxona_id: z.coerce.number().int().positive('Korxonani tanlang'),
  mentor_id: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
  tur_id: z.coerce.number().int().positive('Kundalik turini tanlang'),
  boshlanish_sana: z.string().refine(isYmd, 'Boshlanish sanasi noto\'g\'ri'),
  tugash_sana: z.string().refine(isYmd, 'Tugash sanasi noto\'g\'ri'),
  mavzu: z.string().trim().max(300).optional().default(''),
});

const mentorRoyxatSchema = z.object({
  email: z.string().trim().email('To\'g\'ri Google email kiriting').max(150),
  familiya: z.string().trim().min(2, 'Familiya kamida 2 belgi').max(100),
  ism: z.string().trim().min(2, 'Ism kamida 2 belgi').max(100),
  ochestva: z.string().trim().max(100).optional().default(''),
  lavozim: z.string().trim().min(2, 'Lavozimni kiriting').max(150),
  telefon: z.string().trim().max(30).optional().default(''),
  korxona_id: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
  korxona_nomi: z.string().trim().max(200).optional().default(''),
  ustoz_id: z.coerce.number().int().positive('Biriktiriladigan ustozni tanlang'),
});

const turSchema = z.object({
  kod: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'Kod faqat kichik lotin harflari, raqam va _ bo\'lsin'),
  nomi: z.string().trim().min(3, 'Nomi kamida 3 belgi').max(150),
  tavsif: z.string().trim().max(1000).optional().default(''),
  kunlik_min_soat: z.coerce.number().min(1).max(24).default(6),
  bolimlar_matn: z.string().trim().max(3000).optional().default(''),
});

const mentorAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').trim().toLowerCase()}`,
  handler: (req, res) => res.status(429).render('amaliyot/mentor-kirish', {
    layout: 'bare',
    title: 'Mentor kirishi',
    googleConfigured: isGoogleOAuthConfigured(),
    email: req.body?.email,
    error: 'Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring.',
  }),
});

// =====================================================================
// 1. Ochiq va Mentor marshrutlari (publicRouter — requireLogin dan oldin)
// =====================================================================
const publicRouter = express.Router();
publicRouter.use('/amaliyot/mentor', loadMentor);

publicRouter.get('/amaliyot/mentor/kirish', (req, res) => {
  if (req.mentor) return res.redirect('/amaliyot/mentor');
  res.render('amaliyot/mentor-kirish', {
    layout: 'bare',
    title: 'Mentor kirishi',
    googleConfigured: isGoogleOAuthConfigured(),
    flash: res.locals.flash,
  });
});

publicRouter.post('/amaliyot/mentor/kirish', mentorAuthLimiter, ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).render('amaliyot/mentor-kirish', {
      layout: 'bare',
      title: 'Mentor kirishi',
      googleConfigured: isGoogleOAuthConfigured(),
      error: 'Google email manzilingizni kiriting',
    });
  }
  const auth = await svc.authenticateMentorByGoogle({ email }, req);
  if (auth.status === 'not_found') {
    return res.status(404).render('amaliyot/mentor-kirish', {
      layout: 'bare',
      title: 'Mentor kirishi',
      googleConfigured: isGoogleOAuthConfigured(),
      email,
      error: 'Bu Google akkaunt ro\'yxatdan o\'tmagan. Avval ro\'yxatdan o\'ting.',
    });
  }
  if (auth.status === 'pending') {
    return res.status(403).render('amaliyot/mentor-kirish', {
      layout: 'bare',
      title: 'Mentor kirishi',
      googleConfigured: isGoogleOAuthConfigured(),
      email,
      error: 'Arizangiz hali biriktirilgan ustoz tomonidan tasdiqlanmagan.',
    });
  }
  if (auth.status === 'rejected') {
    return res.status(403).render('amaliyot/mentor-kirish', {
      layout: 'bare',
      title: 'Mentor kirishi',
      googleConfigured: isGoogleOAuthConfigured(),
      email,
      error: `Arizangiz rad etilgan${auth.mentor.rad_sababi ? `: ${auth.mentor.rad_sababi}` : '.'}`,
    });
  }
  if (auth.status === 'frozen') {
    return res.status(403).render('amaliyot/mentor-kirish', {
      layout: 'bare',
      title: 'Mentor kirishi',
      googleConfigured: isGoogleOAuthConfigured(),
      email,
      error: 'Mentor akkauntining bir martalik amal qilish muddati tugagan va muzlatilgan. Ustozga murojaat qiling.',
    });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { status: 500, message: 'Sessiya xatosi' });
    req.session.mentorId = auth.mentor.id;
    req.session.save(() => res.redirect('/amaliyot/mentor'));
  });
}));

publicRouter.get('/amaliyot/mentor/google', (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    flash(req, 'info', 'Google OAuth kalitlari sozlanmagan — Google email orqali ro\'yxatdan o\'ting.');
    return res.redirect('/amaliyot/mentor/royxat');
  }
  res.redirect(createGoogleAuthUrl(req));
});

publicRouter.get('/amaliyot/mentor/google/callback', ah(async (req, res) => {
  if (!isGoogleOAuthConfigured()) return res.redirect('/amaliyot/mentor/kirish');
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.amaliyotOauthState) {
    throw new AppError('Google OAuth state tasdiqlanmadi', 400);
  }
  delete req.session.amaliyotOauthState;

  const profile = await fetchGoogleUser(req, String(code));
  const auth = await svc.authenticateMentorByGoogle(profile, req);

  if (auth.status === 'ok') {
    return req.session.regenerate((err) => {
      if (err) return res.status(500).render('error', { status: 500, message: 'Sessiya xatosi' });
      req.session.mentorId = auth.mentor.id;
      req.session.save(() => res.redirect('/amaliyot/mentor'));
    });
  }

  if (auth.status === 'not_found') {
    req.session.amaliyotGoogleDraft = profile;
    return req.session.save(() => res.redirect('/amaliyot/mentor/royxat'));
  }

  flash(req, 'err', auth.status === 'pending'
    ? 'Arizangiz hali ustoz tasdig\'ini kutmoqda.'
    : 'Mentor akkauntingiz muzlatilgan yoki rad etilgan.');
  res.redirect('/amaliyot/mentor/kirish');
}));

publicRouter.get('/amaliyot/mentor/royxat', ah(async (req, res) => {
  const [korxonalar, ustozlar] = await Promise.all([
    svc.getKorxonalar({ onlyActive: true }),
    svc.getUstozlar(),
  ]);
  const draft = req.session.amaliyotGoogleDraft || {};
  res.render('amaliyot/mentor-royxat', {
    layout: 'bare',
    title: 'Mentor ro\'yxatdan o\'tishi',
    korxonalar,
    ustozlar,
    draft,
    googleConfigured: isGoogleOAuthConfigured(),
    flash: res.locals.flash,
  });
}));

publicRouter.post('/amaliyot/mentor/royxat', ah(async (req, res) => {
  const d = parseZod(mentorRoyxatSchema, req.body);
  if (!d.korxona_id && !d.korxona_nomi) {
    throw new AppError('Korxonani tanlang yoki yangi korxona nomini kiriting', 400);
  }
  const draft = req.session.amaliyotGoogleDraft || {};
  await svc.registerMentor({
    email: d.email,
    familiya: d.familiya,
    ism: d.ism,
    ochestva: d.ochestva,
    lavozim: d.lavozim,
    telefon: d.telefon,
    korxonaId: d.korxona_id || null,
    korxonaNomi: d.korxona_nomi,
    ustozId: d.ustoz_id,
    googleSub: draft.email === d.email.toLowerCase() ? draft.sub : null,
  }, req);
  delete req.session.amaliyotGoogleDraft;
  flash(req, 'ok', 'Ro\'yxatdan o\'tish arizangiz biriktirilgan ustozga yuborildi. Ustoz tasdiqlab muddat belgilagach kirishingiz mumkin.');
  res.redirect('/amaliyot/mentor/kirish');
}));

publicRouter.post('/amaliyot/mentor/chiqish', (req, res) => {
  delete req.session.mentorId;
  flash(req, 'ok', 'Mentor panelidan chiqdingiz');
  req.session.save(() => res.redirect('/amaliyot/mentor/kirish'));
});

publicRouter.get('/amaliyot/mentor', requireMentor, ah(async (req, res) => {
  const biriktirishlar = await svc.getMentorDashboard(req.mentor.id);
  const decorated = biriktirishlar.map((b) => ({
    ...b,
    boshlanish_fmt: fmtDate(b.boshlanish_sana),
    tugash_fmt: fmtDate(b.tugash_sana),
    kundaliklar: b.kundaliklar.map(decorateKundalik),
    xulosa_badge: badgeMeta(b.xulosa_mentor_holat || 'kutilmoqda'),
  }));
  res.render('amaliyot/mentor-panel', {
    title: 'Mentor paneli',
    mentorInfo: decorateMentor(req.mentor),
    biriktirishlar: decorated,
  });
}));

publicRouter.post('/amaliyot/mentor/biriktirish/:id/tasdiqlash-hammasi', requireMentor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { fikr } = parseZod(z.object({
    fikr: z.string().trim().max(2000).optional().default(''),
  }), req.body);
  const count = await svc.approveAllKundalikByMentor(id, req.mentor, fikr, req);
  flash(req, 'ok', `${count} ta kunlik yozuv mentor tomonidan tasdiqlandi`);
  res.redirect('/amaliyot/mentor');
}));

publicRouter.post('/amaliyot/mentor/kundalik/:id/holat', requireMentor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { holat, fikr } = parseZod(z.object({
    holat: z.enum(['tasdiqlandi', 'qaytarildi']),
    fikr: z.string().trim().max(2000).optional().default(''),
  }), req.body);
  await svc.reviewKundalikByMentor({ kundalikId: id, holat, fikr }, req.mentor, req);
  flash(req, 'ok', 'Kundalik yozovi bo\'yicha mentor qarori saqlandi');
  res.redirect('/amaliyot/mentor');
}));

publicRouter.post('/amaliyot/mentor/xulosa/:id/holat', requireMentor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { holat, fikr } = parseZod(z.object({
    holat: z.enum(['tasdiqlandi', 'qaytarildi']),
    fikr: z.string().trim().max(2000).optional().default(''),
  }), req.body);
  await svc.reviewXulosaByMentor({ xulosaId: id, holat, fikr }, req.mentor, req);
  flash(req, 'ok', 'Xulosalar kitobchasi bo\'yicha mentor fikri saqlandi');
  res.redirect('/amaliyot/mentor');
}));

publicRouter.get('/amaliyot/mentor/biriktirish/:id/docx', requireMentor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const full = await svc.getBiriktirishFull(id);
  if (full.biriktirish.mentor_id !== req.mentor.id) throw forbidden('Bu talaba sizga biriktirilmagan');
  const buf = buildKundalikDocx(full);
  sendDocx(res, `amaliyot-kundalik-${id}.docx`, buf);
}));

publicRouter.get('/amaliyot/mentor/biriktirish/:id/xulosa-docx', requireMentor, ah(async (req, res) => {
  const id = idParam(req.params.id);
  const full = await svc.getBiriktirishFull(id);
  if (full.biriktirish.mentor_id !== req.mentor.id) throw forbidden('Bu talaba sizga biriktirilmagan');
  const buf = buildXulosaDocx(full);
  sendDocx(res, `xulosalar-kitobchasi-${id}.docx`, buf);
}));

// =====================================================================
// 2. Asosiy tizim marshrutlari (router — requireLogin dan keyin)
// =====================================================================
const router = express.Router();

router.get('/amaliyot', ah(async (req, res) => {
  if (['teacher', 'dekanat', 'admin'].includes(req.user.role)) {
    return res.redirect('/amaliyot/ustoz');
  }
  if (req.user.role !== 'student') {
    throw forbidden('Amaliyot kundaligi bo\'limiga ruxsat yo\'q');
  }

  const selectedId = req.query.b ? idParam(req.query.b) : null;
  const { biriktirishlar, active, kundaliklar, xulosa, notifications } = await svc.getStudentDashboard(req.user.id, selectedId, req);
  res.render('amaliyot/talaba', {
    title: 'Amaliyot kundaligi',
    hasMultiple: biriktirishlar.length > 1,
    biriktirishlar: biriktirishlar.map((b) => ({
      ...b,
      boshlanish_fmt: fmtDate(b.boshlanish_sana),
      tugash_fmt: fmtDate(b.tugash_sana),
      holat_badge: badgeMeta(b.holat),
      is_selected: active && b.id === active.id,
    })),
    active: active ? {
      ...active,
      boshlanish_fmt: fmtDate(active.boshlanish_sana),
      tugash_fmt: fmtDate(active.tugash_sana),
      holat_badge: badgeMeta(active.holat),
      bolimlar: buildBolimRows(active.bolimlar_json, xulosa?.bolimlar_javobi),
    } : null,
    stats: computeDiaryStats(kundaliklar),
    kundaliklar: kundaliklar.map(decorateKundalik),
    notifications: notifications.map((n) => ({ ...n, vaqt_fmt: fmtTimestamp(n.created_at) })),
    xulosa: xulosa ? {
      ...xulosa,
      talaba_badge: badgeMeta(xulosa.talaba_holat),
      ustoz_badge: badgeMeta(xulosa.ustoz_holat),
      mentor_badge: badgeMeta(xulosa.mentor_holat),
    } : null,
    bugun: today(),
  });
}));

router.post('/amaliyot/kundalik', requireRole('student'), ah(async (req, res) => {
  const d = parseZod(kundalikSchema, req.body);
  await svc.upsertKundalik({
    biriktirishId: d.biriktirish_id,
    sana: d.sana,
    ishMazmuni: d.ish_mazmuni,
    soat: d.soat,
    natija: d.natija,
  }, req.user.id, req);
  flash(req, 'ok', `${fmtDate(d.sana)} uchun kundalik yozuvi saqlandi`);
  res.redirect(`/amaliyot?b=${d.biriktirish_id}`);
}));

router.post('/amaliyot/kundalik/:id/ochirish', requireRole('student'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const biriktirishId = await svc.deleteKundalik(id, req.user.id, req);
  flash(req, 'ok', 'Kundalik yozuvi o\'chirildi');
  res.redirect(`/amaliyot?b=${biriktirishId}`);
}));

router.get('/amaliyot/xulosa', requireRole('student'), ah(async (req, res) => {
  const selectedId = req.query.b ? idParam(req.query.b) : null;
  const { active, xulosa } = await svc.getStudentDashboard(req.user.id, selectedId, req);
  if (!active) {
    flash(req, 'err', 'Siz hali amaliyotga biriktirilmagansiz');
    return res.redirect('/amaliyot');
  }
  const full = await svc.getBiriktirishFull(active.id);
  res.render('amaliyot/xulosa', {
    title: 'Xulosalar kitobchasi',
    biriktirish: {
      ...full.biriktirish,
      boshlanish_fmt: fmtDate(full.biriktirish.boshlanish_sana),
      tugash_fmt: fmtDate(full.biriktirish.tugash_sana),
    },
    bolimlar: buildBolimRows(full.biriktirish.bolimlar_json, xulosa?.bolimlar_javobi),
    xulosa: xulosa ? {
      ...xulosa,
      talaba_badge: badgeMeta(xulosa.talaba_holat),
      ustoz_badge: badgeMeta(xulosa.ustoz_holat),
      mentor_badge: badgeMeta(xulosa.mentor_holat),
    } : {},
  });
}));

router.post('/amaliyot/xulosa', requireRole('student'), ah(async (req, res) => {
  const biriktirishId = idParam(req.body.biriktirish_id);
  const full = await svc.getBiriktirishFull(biriktirishId);
  if (full.biriktirish.student_id !== req.user.id) throw forbidden();

  const bolimlar = Array.isArray(full.biriktirish.bolimlar_json) ? full.biriktirish.bolimlar_json : [];
  const bolimlarJavobi = {};
  for (const sec of bolimlar) {
    bolimlarJavobi[sec.key] = String(req.body[`bolim_${sec.key}`] || '').trim().slice(0, 4000);
  }

  const topshirish = req.body.harakat === 'topshirish';
  const d = parseZod(z.object({
    bajarilgan_ishlar_xulosasi: z.string().trim().max(5000).optional().default(''),
    ozlashtirilgan_konikmalar: z.string().trim().max(5000).optional().default(''),
    muammo_va_takliflar: z.string().trim().max(5000).optional().default(''),
    yakuniy_xulosa: z.string().trim().max(5000).optional().default(''),
  }), req.body);

  if (topshirish && (!d.bajarilgan_ishlar_xulosasi || !d.yakuniy_xulosa)) {
    throw new AppError('Topshirishdan oldin bajarilgan ishlar xulosasi va yakuniy xulosani to\'ldiring', 400);
  }

  await svc.upsertXulosa({
    biriktirishId,
    bolimlarJavobi,
    bajarilganIshlar: d.bajarilgan_ishlar_xulosasi,
    konikmalar: d.ozlashtirilgan_konikmalar,
    muammoTakliflar: d.muammo_va_takliflar,
    yakuniyXulosa: d.yakuniy_xulosa,
    topshirish,
  }, req.user.id, req);

  flash(req, 'ok', topshirish ? 'Xulosalar kitobchasi tasdiqlash uchun topshirildi' : 'Xulosalar kitobchasi qoralama sifatida saqlandi');
  res.redirect('/amaliyot/xulosa');
}));

router.get('/amaliyot/:id/docx', requireRole('student', 'teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const full = await svc.getBiriktirishFull(id);
  await svc.assertBiriktirishAccess(req.user, full.biriktirish, req, 'view');
  const buf = buildKundalikDocx(full);
  sendDocx(res, `amaliyot-kundalik-${id}.docx`, buf);
}));

router.get('/amaliyot/:id/xulosa-docx', requireRole('student', 'teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const full = await svc.getBiriktirishFull(id);
  await svc.assertBiriktirishAccess(req.user, full.biriktirish, req, 'view');
  const buf = buildXulosaDocx(full);
  sendDocx(res, `xulosalar-kitobchasi-${id}.docx`, buf);
}));

// ---------- Ustoz / Dekanat / Admin paneli ----------
router.get('/amaliyot/ustoz', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const data = await svc.getUstozDashboard(req.user, req);
  res.render('amaliyot/ustoz', {
    title: 'Amaliyot nazorati (Ustoz)',
    biriktirishlar: data.biriktirishlar.map((b) => ({
      ...b,
      boshlanish_fmt: fmtDate(b.boshlanish_sana),
      tugash_fmt: fmtDate(b.tugash_sana),
      holat_badge: badgeMeta(b.holat),
      xulosa_badge: badgeMeta(b.xulosa_ustoz_holat || 'kutilmoqda'),
    })),
    mentorlar: data.mentorlar.map(decorateMentor),
    activeMentors: data.activeMentors,
    pendingMentorsCount: data.pendingMentorsCount,
    talabalar: data.talabalar,
    korxonalar: data.korxonalar,
    turlar: data.turlar,
    notifications: data.notifications.map((n) => ({ ...n, vaqt_fmt: fmtTimestamp(n.created_at) })),
    bugun: today(),
  });
}));

router.get('/amaliyot/ustoz/talaba/:id', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const full = await svc.getBiriktirishFull(id);
  await svc.assertBiriktirishAccess(req.user, full.biriktirish, req, 'manage');
  const [turlar, dash] = await Promise.all([
    svc.getTurlar({ onlyActive: true }),
    svc.getUstozDashboard(req.user, req),
  ]);

  res.render('amaliyot/ustoz-detail', {
    title: `${full.biriktirish.student_fio} — Amaliyot`,
    biriktirish: {
      ...full.biriktirish,
      boshlanish_fmt: fmtDate(full.biriktirish.boshlanish_sana),
      tugash_fmt: fmtDate(full.biriktirish.tugash_sana),
      holat_badge: badgeMeta(full.biriktirish.holat),
    },
    stats: computeDiaryStats(full.kundaliklar),
    bolimlar: buildBolimRows(full.biriktirish.bolimlar_json, full.xulosa?.bolimlar_javobi),
    kundaliklar: full.kundaliklar.map(decorateKundalik),
    xulosa: full.xulosa ? {
      ...full.xulosa,
      talaba_badge: badgeMeta(full.xulosa.talaba_holat),
      ustoz_badge: badgeMeta(full.xulosa.ustoz_holat),
      mentor_badge: badgeMeta(full.xulosa.mentor_holat),
    } : null,
    turlar,
    korxonalar: dash.korxonalar,
    activeMentors: dash.activeMentors,
  });
}));

router.post('/amaliyot/korxona', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const d = parseZod(korxonaSchema, req.body);
  await svc.createKorxona({
    nomi: d.nomi,
    manzil: d.manzil,
    stir: d.stir,
    rahbarFio: d.rahbar_fio,
    telefon: d.telefon,
  }, req.user, req);
  flash(req, 'ok', `"${d.nomi}" korxonasi qo'shildi`);
  res.redirect('/amaliyot/ustoz');
}));

router.post('/amaliyot/biriktirish', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const d = parseZod(biriktirishSchema, req.body);
  await svc.createBiriktirish({
    studentId: d.student_id,
    korxonaId: d.korxona_id,
    mentorId: d.mentor_id || null,
    turId: d.tur_id,
    boshlanishSana: d.boshlanish_sana,
    tugashSana: d.tugash_sana,
    mavzu: d.mavzu,
  }, req.user, req);
  flash(req, 'ok', 'Talaba amaliyotga muvaffaqiyatli biriktirildi');
  res.redirect('/amaliyot/ustoz');
}));

router.post('/amaliyot/biriktirish/:id/tur', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { tur_id } = parseZod(z.object({ tur_id: z.coerce.number().int().positive() }), req.body);
  const tur = await svc.changeDiaryType(id, tur_id, req.user, req);
  flash(req, 'ok', `Kundalik turi "${tur.nomi}" ga o'zgartirildi`);
  res.redirect(`/amaliyot/ustoz/talaba/${id}`);
}));

router.post('/amaliyot/biriktirish/:id/tahrirlash', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const d = parseZod(z.object({
    korxona_id: z.coerce.number().int().positive(),
    boshlanish_sana: z.string().refine(isYmd, 'Boshlanish sanasi noto\'g\'ri'),
    tugash_sana: z.string().refine(isYmd, 'Tugash sanasi noto\'g\'ri'),
    mavzu: z.string().trim().max(300).optional().default(''),
    holat: z.enum(['faol', 'yakunlangan', 'bekor_qilingan']),
  }), req.body);
  await svc.updateBiriktirish(id, {
    korxonaId: d.korxona_id,
    boshlanishSana: d.boshlanish_sana,
    tugashSana: d.tugash_sana,
    mavzu: d.mavzu,
    holat: d.holat,
  }, req.user, req);
  flash(req, 'ok', 'Amaliyot biriktirishi ma\'lumotlari yangilandi');
  res.redirect(`/amaliyot/ustoz/talaba/${id}`);
}));

router.post('/amaliyot/biriktirish/:id/mentor', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { mentor_id } = parseZod(z.object({
    mentor_id: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
  }), req.body);
  await svc.assignMentorToBiriktirish(id, mentor_id || null, req.user, req);
  flash(req, 'ok', 'Korxona mentori biriktirishi yangilandi');
  res.redirect(`/amaliyot/ustoz/talaba/${id}`);
}));

router.post('/amaliyot/biriktirish/:id/tasdiqlash-hammasi', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const count = await svc.approveAllKundalikByUstoz(id, req.user, req);
  flash(req, 'ok', `${count} ta kunlik yozuv tasdiqlandi`);
  res.redirect(`/amaliyot/ustoz/talaba/${id}`);
}));

router.post('/amaliyot/kundalik/:id/ustoz-holat', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const { holat, izoh } = parseZod(z.object({
    holat: z.enum(['tasdiqlandi', 'qaytarildi']),
    izoh: z.string().trim().max(2000).optional().default(''),
  }), req.body);
  const { biriktirishId } = await svc.reviewKundalikByUstoz({ kundalikId: id, holat, izoh }, req.user, req);
  flash(req, 'ok', 'Kundalik yozovi bo\'yicha qaror saqlandi');
  res.redirect(`/amaliyot/ustoz/talaba/${biriktirishId}`);
}));

router.post('/amaliyot/xulosa/:id/ustoz-holat', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const d = parseZod(z.object({
    holat: z.enum(['tasdiqlandi', 'qaytarildi']),
    izoh: z.string().trim().max(2000).optional().default(''),
    baho: z.union([z.literal(''), z.coerce.number().int().min(0).max(100)]).optional(),
  }), req.body);
  const { biriktirishId } = await svc.reviewXulosaByUstoz({
    xulosaId: id,
    holat: d.holat,
    izoh: d.izoh,
    baho: d.baho === '' || d.baho === undefined ? null : d.baho,
  }, req.user, req);
  flash(req, 'ok', 'Xulosalar kitobchasi bo\'yicha qaror saqlandi');
  res.redirect(`/amaliyot/ustoz/talaba/${biriktirishId}`);
}));

router.post('/amaliyot/mentor/:id/tasdiqlash', requireRole('teacher', 'dekanat', 'admin'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const d = parseZod(z.object({
    action: z.enum(['tasdiqlash', 'rad_etish', 'muzlatish']),
    muddat_kun: z.union([z.literal(''), z.coerce.number().int().min(1).max(720)]).optional(),
    muddat_birlik: z.enum(['kun', 'soat']).optional().default('kun'),
    korxona_id: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
    rad_sababi: z.string().trim().max(500).optional().default(''),
  }), req.body);
  await svc.reviewMentorByUstoz({
    mentorId: id,
    action: d.action,
    muddatKun: d.muddat_kun,
    muddatBirlik: d.muddat_birlik,
    korxonaId: d.korxona_id || null,
    radSababi: d.rad_sababi,
  }, req.user, req);
  flash(req, 'ok', 'Mentor holati yangilandi');
  res.redirect('/amaliyot/ustoz');
}));

// ---------- Kundalik turlarini boshqarish ----------
router.get('/admin/amaliyot/turlar', requireRole('admin', 'dekanat', 'teacher'), ah(async (req, res) => {
  const turlar = await svc.getTurlar({ onlyActive: false });
  res.render('amaliyot/turlar', {
    title: 'Amaliyot kundaligi turlari',
    turlar: turlar.map((t) => ({
      ...t,
      bolimlar_count: Array.isArray(t.bolimlar_json) ? t.bolimlar_json.length : 0,
      bolimlar_list: Array.isArray(t.bolimlar_json) ? t.bolimlar_json : [],
      bolimlar_matn: formatBolimlarMatn(t.bolimlar_json),
    })),
  });
}));

router.post('/admin/amaliyot/turlar', requireRole('admin', 'dekanat', 'teacher'), ah(async (req, res) => {
  const d = parseZod(turSchema, req.body);
  await svc.createTur({
    kod: d.kod,
    nomi: d.nomi,
    tavsif: d.tavsif,
    kunlikMinSoat: d.kunlik_min_soat,
    bolimlar: parseBolimlarMatn(d.bolimlar_matn),
  }, req.user, req);
  flash(req, 'ok', `"${d.nomi}" kundalik turi qo'shildi`);
  res.redirect('/admin/amaliyot/turlar');
}));

router.post('/admin/amaliyot/turlar/:id', requireRole('admin', 'dekanat', 'teacher'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  const d = parseZod(z.object({
    nomi: z.string().trim().min(3, 'Nomi kamida 3 belgi').max(150),
    tavsif: z.string().trim().max(1000).optional().default(''),
    kunlik_min_soat: z.coerce.number().min(1).max(24).default(6),
    bolimlar_matn: z.string().trim().max(3000).optional().default(''),
  }), req.body);
  await svc.updateTur(id, {
    nomi: d.nomi,
    tavsif: d.tavsif,
    kunlikMinSoat: d.kunlik_min_soat,
    bolimlar: parseBolimlarMatn(d.bolimlar_matn),
  }, req.user, req);
  flash(req, 'ok', `"${d.nomi}" kundalik turi yangilandi`);
  res.redirect('/admin/amaliyot/turlar');
}));

router.post('/admin/amaliyot/turlar/:id/holat', requireRole('admin', 'dekanat', 'teacher'), ah(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.toggleTurStatus(id, req);
  flash(req, 'ok', 'Amaliyot turi holati o\'zgartirildi');
  res.redirect('/admin/amaliyot/turlar');
}));

module.exports = { router, publicRouter };
