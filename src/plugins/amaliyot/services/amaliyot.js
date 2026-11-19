// Amaliyot kundaligi biznes-logikasi va parametrli SQL so'rovlari
const db = require('../../../db/pool');
const { AppError, forbidden, notFound } = require('../../../lib/http');
const { audit } = require('../../../lib/audit');
const { userScope } = require('../../../lib/scope');
const { notify } = require('../../../modules/navbat/notify');
const { freezeExpiredMentors } = require('../lib/mentor-auth');

async function getTurlar({ onlyActive = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM amaliyot_turlar
      ${onlyActive ? 'WHERE faol = TRUE' : ''}
      ORDER BY id`,
  );
  return rows;
}

async function getKorxonalar({ onlyActive = true } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM amaliyot_korxonalar
      ${onlyActive ? 'WHERE faol = TRUE' : ''}
      ORDER BY nomi`,
  );
  return rows;
}

async function getUstozlar() {
  const { rows } = await db.query(
    `SELECT u.id, u.familiya, u.ism, u.ochestva, u.role
       FROM users u
      WHERE u.status = TRUE AND u.role IN ('teacher', 'dekanat')
      ORDER BY u.familiya, u.ism`,
  );
  return rows;
}

async function getBiriktirishDetail(biriktirishId) {
  const { rows: [b] } = await db.query(
    `SELECT b.*,
            t.kod AS tur_kod, t.nomi AS tur_nomi, t.bolimlar_json, t.kunlik_min_soat,
            k.nomi AS korxona_nomi, k.manzil AS korxona_manzil, k.stir AS korxona_stir,
            k.rahbar_fio AS korxona_rahbar, k.telefon AS korxona_telefon,
            trim(concat_ws(' ', st.familiya, st.ism, st.ochestva)) AS student_fio,
            si.guruh, si.kurs, fak.nomi AS fakultet_nomi, g.fakultet_id,
            trim(concat_ws(' ', us.familiya, us.ism, us.ochestva)) AS ustoz_fio,
            trim(concat_ws(' ', mn.familiya, mn.ism, mn.ochestva)) AS mentor_fio,
            mn.lavozim AS mentor_lavozim, mn.email AS mentor_email, mn.holat AS mentor_akkaunt_holat
       FROM amaliyot_biriktirishlar b
       JOIN amaliyot_turlar t ON t.id = b.tur_id
       JOIN amaliyot_korxonalar k ON k.id = b.korxona_id
       JOIN users st ON st.id = b.student_id
       LEFT JOIN student_info si ON si.user_id = st.id
       LEFT JOIN guruhlar g ON g.nomi = si.guruh
       LEFT JOIN bolimlar fak ON fak.id = g.fakultet_id
       JOIN users us ON us.id = b.ustoz_id
       LEFT JOIN amaliyot_mentorlar mn ON mn.id = b.mentor_id
      WHERE b.id = $1`,
    [biriktirishId],
  );
  if (!b) throw notFound('Amaliyot biriktirishi topilmadi');
  return b;
}

async function assertBiriktirishAccess(actor, b, req, mode = 'view') {
  if (actor.role === 'admin') return;
  if (actor.role === 'student') {
    if (mode !== 'view' || b.student_id !== actor.id) throw forbidden();
    return;
  }
  if (actor.role === 'teacher') {
    if (b.ustoz_id !== actor.id) throw forbidden('Bu amaliyot sizga biriktirilmagan');
    return;
  }
  if (actor.role === 'dekanat') {
    const scope = await userScope(actor, req);
    if (!scope.fakultetId || b.fakultet_id !== scope.fakultetId) {
      throw forbidden('Boshqa fakultet talabasiga ruxsat yo\'q');
    }
    return;
  }
  throw forbidden();
}

async function getRecentNotifications(userId, limit = 5) {
  const { rows } = await db.query(
    `SELECT id, matn, holat, created_at
       FROM bildirishnomalar
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

async function getStudentDashboard(studentId, selectedId = null, req = null) {
  await freezeExpiredMentors(db, req);
  const [{ rows: biriktirishlar }, notifications] = await Promise.all([
    db.query(
      `SELECT b.*,
              t.nomi AS tur_nomi, t.kod AS tur_kod, t.bolimlar_json, t.kunlik_min_soat,
              k.nomi AS korxona_nomi, k.manzil AS korxona_manzil,
              trim(concat_ws(' ', us.familiya, us.ism, us.ochestva)) AS ustoz_fio,
              trim(concat_ws(' ', mn.familiya, mn.ism, mn.ochestva)) AS mentor_fio,
              mn.lavozim AS mentor_lavozim, mn.holat AS mentor_akkaunt_holat
         FROM amaliyot_biriktirishlar b
         JOIN amaliyot_turlar t ON t.id = b.tur_id
         JOIN amaliyot_korxonalar k ON k.id = b.korxona_id
         JOIN users us ON us.id = b.ustoz_id
         LEFT JOIN amaliyot_mentorlar mn ON mn.id = b.mentor_id
        WHERE b.student_id = $1
        ORDER BY (b.holat = 'faol') DESC, b.boshlanish_sana DESC, b.id DESC`,
      [studentId],
    ),
    getRecentNotifications(studentId, 4),
  ]);

  const active = (selectedId && biriktirishlar.find((x) => x.id === Number(selectedId)))
    || biriktirishlar.find((x) => x.holat === 'faol')
    || biriktirishlar[0]
    || null;
  let kundaliklar = [];
  let xulosa = null;
  if (active) {
    const [{ rows: kRows }, { rows: xRows }] = await Promise.all([
      db.query('SELECT * FROM amaliyot_kundalik WHERE biriktirish_id = $1 ORDER BY sana DESC, id DESC', [active.id]),
      db.query('SELECT * FROM amaliyot_xulosalar WHERE biriktirish_id = $1', [active.id]),
    ]);
    kundaliklar = kRows;
    xulosa = xRows[0] || null;
  }
  return { biriktirishlar, active, kundaliklar, xulosa, notifications };
}

async function getBiriktirishFull(biriktirishId) {
  const b = await getBiriktirishDetail(biriktirishId);
  const [{ rows: kundaliklar }, { rows: [xulosa] }] = await Promise.all([
    db.query('SELECT * FROM amaliyot_kundalik WHERE biriktirish_id = $1 ORDER BY sana ASC, id ASC', [b.id]),
    db.query('SELECT * FROM amaliyot_xulosalar WHERE biriktirish_id = $1', [b.id]),
  ]);
  return { biriktirish: b, kundaliklar, xulosa: xulosa || null };
}

async function getUstozDashboard(actor, req) {
  await freezeExpiredMentors(db, req);
  const scope = actor.role === 'dekanat' ? await userScope(actor, req) : null;
  const isAll = actor.role === 'admin';
  const fakId = scope?.fakultetId || null;

  const [
    { rows: biriktirishlar },
    { rows: mentorlar },
    { rows: talabalar },
    korxonalar,
    turlar,
    notifications,
  ] = await Promise.all([
    db.query(
      `SELECT b.*,
              t.nomi AS tur_nomi, k.nomi AS korxona_nomi,
              trim(concat_ws(' ', st.familiya, st.ism)) AS student_fio, si.guruh,
              trim(concat_ws(' ', us.familiya, us.ism)) AS ustoz_fio,
              trim(concat_ws(' ', mn.familiya, mn.ism)) AS mentor_fio,
              (SELECT count(*)::int FROM amaliyot_kundalik ak WHERE ak.biriktirish_id = b.id) AS jami_kun,
              (SELECT count(*)::int FROM amaliyot_kundalik ak WHERE ak.biriktirish_id = b.id AND ak.ustoz_holat = 'kutilmoqda') AS kutilayotgan_kun,
              x.talaba_holat, x.ustoz_holat AS xulosa_ustoz_holat, x.ustoz_baho
         FROM amaliyot_biriktirishlar b
         JOIN amaliyot_turlar t ON t.id = b.tur_id
         JOIN amaliyot_korxonalar k ON k.id = b.korxona_id
         JOIN users st ON st.id = b.student_id
         LEFT JOIN student_info si ON si.user_id = st.id
         LEFT JOIN guruhlar g ON g.nomi = si.guruh
         JOIN users us ON us.id = b.ustoz_id
         LEFT JOIN amaliyot_mentorlar mn ON mn.id = b.mentor_id
         LEFT JOIN amaliyot_xulosalar x ON x.biriktirish_id = b.id
        WHERE ($1::boolean OR ($2::bigint IS NOT NULL AND g.fakultet_id = $2) OR b.ustoz_id = $3)
        ORDER BY (b.holat = 'faol') DESC, b.id DESC`,
      [isAll, fakId, actor.id],
    ),
    db.query(
      `SELECT m.*,
              COALESCE(k.nomi, m.korxona_nomi_kiritilgan) AS korxona_nomi,
              trim(concat_ws(' ', us.familiya, us.ism)) AS ustoz_fio
         FROM amaliyot_mentorlar m
         LEFT JOIN amaliyot_korxonalar k ON k.id = m.korxona_id
         JOIN users us ON us.id = m.ustoz_id
        WHERE ($1::boolean OR $2::bigint IS NOT NULL OR m.ustoz_id = $3)
        ORDER BY (m.holat = 'kutilmoqda') DESC, m.id DESC`,
      [isAll, fakId, actor.id],
    ),
    db.query(
      `SELECT u.id, u.familiya, u.ism, u.ochestva, si.guruh, si.kurs
         FROM users u
         LEFT JOIN student_info si ON si.user_id = u.id
         LEFT JOIN guruhlar g ON g.nomi = si.guruh
        WHERE u.role = 'student' AND u.status = TRUE
          AND ($1::bigint IS NULL OR g.fakultet_id = $1)
        ORDER BY si.guruh NULLS LAST, u.familiya, u.ism`,
      [actor.role === 'dekanat' ? (fakId || -1) : null],
    ),
    getKorxonalar({ onlyActive: true }),
    getTurlar({ onlyActive: true }),
    getRecentNotifications(actor.id, 5),
  ]);

  const activeMentors = mentorlar.filter((m) => m.holat === 'tasdiqlandi');
  const pendingMentorsCount = mentorlar.filter((m) => m.holat === 'kutilmoqda').length;

  return {
    biriktirishlar,
    mentorlar,
    activeMentors,
    pendingMentorsCount,
    talabalar,
    korxonalar,
    turlar,
    notifications,
  };
}

async function createKorxona({ nomi, manzil, stir, rahbarFio, telefon }, actor, req) {
  const { rows: existing } = await db.query('SELECT id FROM amaliyot_korxonalar WHERE lower(nomi) = lower($1)', [nomi]);
  if (existing.length) throw new AppError('Bu nomdagi korxona allaqachon mavjud', 400);

  const { rows: [created] } = await db.query(
    `INSERT INTO amaliyot_korxonalar (nomi, manzil, stir, rahbar_fio, telefon, yaratgan_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [nomi, manzil || null, stir || null, rahbarFio || null, telefon || null, actor.id],
  );
  await audit({ req, amal: 'amaliyot.korxona_create', obyekt: 'amaliyot_korxonalar', obyektId: created.id, yangi: created });
  return created;
}

async function createBiriktirish(data, actor, req) {
  if (data.tugashSana < data.boshlanishSana) {
    throw new AppError('Tugash sanasi boshlanish sanasidan oldin bo\'lishi mumkin emas', 400);
  }
  return db.tx(async (client) => {
    const { rows: [st] } = await client.query(
      "SELECT id, familiya, ism FROM users WHERE id = $1 AND role = 'student' AND status = TRUE",
      [data.studentId],
    );
    if (!st) throw new AppError('Faol talaba topilmadi', 400);

    if (actor.role === 'dekanat') {
      const scope = await userScope(actor, req);
      const { rows: [g] } = await client.query(
        `SELECT g.fakultet_id FROM student_info si JOIN guruhlar g ON g.nomi = si.guruh WHERE si.user_id = $1`,
        [st.id],
      );
      if (!scope.fakultetId || !g || g.fakultet_id !== scope.fakultetId) {
        throw forbidden('Boshqa fakultet talabasini biriktira olmaysiz');
      }
    }

    const { rows: [kor] } = await client.query('SELECT id, nomi FROM amaliyot_korxonalar WHERE id = $1 AND faol = TRUE', [data.korxonaId]);
    if (!kor) throw new AppError('Korxona topilmadi', 400);

    const { rows: [tur] } = await client.query('SELECT id, nomi FROM amaliyot_turlar WHERE id = $1 AND faol = TRUE', [data.turId]);
    if (!tur) throw new AppError('Amaliyot turi topilmadi', 400);

    let mentorId = null;
    if (data.mentorId) {
      const { rows: [m] } = await client.query('SELECT id, holat FROM amaliyot_mentorlar WHERE id = $1', [data.mentorId]);
      if (!m || m.holat !== 'tasdiqlandi') {
        throw new AppError('Tanlangan mentor tasdiqlangan va faol bo\'lishi shart', 400);
      }
      mentorId = m.id;
    }

    const ustozId = actor.role === 'teacher' ? actor.id : (data.ustozId || actor.id);
    const { rows: [b] } = await client.query(
      `INSERT INTO amaliyot_biriktirishlar
         (student_id, ustoz_id, korxona_id, mentor_id, tur_id, boshlanish_sana, tugash_sana, mavzu)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [st.id, ustozId, kor.id, mentorId, tur.id, data.boshlanishSana, data.tugashSana, data.mavzu || null],
    );
    await client.query('INSERT INTO amaliyot_xulosalar (biriktirish_id) VALUES ($1)', [b.id]);
    await notify(client, st.id, `Siz "${kor.nomi}" korxonasiga "${tur.nomi}" amaliyotiga biriktirildingiz (${data.boshlanishSana} – ${data.tugashSana}).`);
    await audit({ client, req, amal: 'amaliyot.biriktirish_create', obyekt: 'amaliyot_biriktirishlar', obyektId: b.id, yangi: b });
    return b;
  });
}

async function changeDiaryType(biriktirishId, turId, actor, req) {
  const b = await getBiriktirishDetail(biriktirishId);
  await assertBiriktirishAccess(actor, b, req, 'manage');
  return db.tx(async (client) => {
    const { rows: [tur] } = await client.query('SELECT id, nomi FROM amaliyot_turlar WHERE id = $1 AND faol = TRUE', [turId]);
    if (!tur) throw new AppError('Amaliyot turi topilmadi', 400);
    await client.query(
      'UPDATE amaliyot_biriktirishlar SET tur_id = $1, updated_at = now() WHERE id = $2',
      [tur.id, b.id],
    );
    await notify(client, b.student_id, `Ustoz tomonidan amaliyot kundaligi turi "${tur.nomi}" ga o'zgartirildi.`);
    await audit({
      client,
      req,
      amal: 'amaliyot.tur_change',
      obyekt: 'amaliyot_biriktirishlar',
      obyektId: b.id,
      eski: { tur_id: b.tur_id, tur_nomi: b.tur_nomi },
      yangi: { tur_id: tur.id, tur_nomi: tur.nomi },
    });
    return tur;
  });
}

async function assignMentorToBiriktirish(biriktirishId, mentorId, actor, req) {
  const b = await getBiriktirishDetail(biriktirishId);
  await assertBiriktirishAccess(actor, b, req, 'manage');
  return db.tx(async (client) => {
    let validMentorId = null;
    if (mentorId) {
      const { rows: [m] } = await client.query('SELECT id, holat, ism, familiya FROM amaliyot_mentorlar WHERE id = $1', [mentorId]);
      if (!m || m.holat !== 'tasdiqlandi') {
        throw new AppError('Faqat tasdiqlangan va faol mentorni biriktirish mumkin', 400);
      }
      validMentorId = m.id;
    }
    await client.query(
      'UPDATE amaliyot_biriktirishlar SET mentor_id = $1, updated_at = now() WHERE id = $2',
      [validMentorId, b.id],
    );
    await audit({
      client,
      req,
      amal: 'amaliyot.mentor_assign',
      obyekt: 'amaliyot_biriktirishlar',
      obyektId: b.id,
      eski: { mentor_id: b.mentor_id },
      yangi: { mentor_id: validMentorId },
    });
  });
}

async function updateBiriktirish(biriktirishId, { korxonaId, boshlanishSana, tugashSana, mavzu, holat }, actor, req) {
  if (tugashSana < boshlanishSana) {
    throw new AppError('Tugash sanasi boshlanish sanasidan oldin bo\'lishi mumkin emas', 400);
  }
  const b = await getBiriktirishDetail(biriktirishId);
  await assertBiriktirishAccess(actor, b, req, 'manage');
  return db.tx(async (client) => {
    const { rows: [kor] } = await client.query('SELECT id FROM amaliyot_korxonalar WHERE id = $1', [korxonaId]);
    if (!kor) throw new AppError('Korxona topilmadi', 400);
    const { rows: [updated] } = await client.query(
      `UPDATE amaliyot_biriktirishlar
          SET korxona_id = $1,
              boshlanish_sana = $2,
              tugash_sana = $3,
              mavzu = $4,
              holat = $5,
              updated_at = now()
        WHERE id = $6 RETURNING *`,
      [kor.id, boshlanishSana, tugashSana, mavzu || null, holat, b.id],
    );
    if (holat !== b.holat) {
      await notify(client, b.student_id, `Amaliyot holatingiz "${holat}" ga o'zgartirildi.`);
    }
    await audit({
      client,
      req,
      amal: 'amaliyot.biriktirish_update',
      obyekt: 'amaliyot_biriktirishlar',
      obyektId: b.id,
      eski: { korxona_id: b.korxona_id, boshlanish_sana: b.boshlanish_sana, tugash_sana: b.tugash_sana, holat: b.holat },
      yangi: { korxona_id: kor.id, boshlanish_sana: boshlanishSana, tugash_sana: tugashSana, holat },
    });
    return updated;
  });
}

async function deleteKundalik(kundalikId, studentId, req) {
  return db.tx(async (client) => {
    const { rows: [k] } = await client.query(
      `SELECT ak.*, ab.student_id
         FROM amaliyot_kundalik ak
         JOIN amaliyot_biriktirishlar ab ON ab.id = ak.biriktirish_id
        WHERE ak.id = $1 FOR UPDATE`,
      [kundalikId],
    );
    if (!k) throw notFound('Kundalik yozuvi topilmadi');
    if (k.student_id !== studentId) throw forbidden();
    if (k.ustoz_holat === 'tasdiqlandi' || k.mentor_holat === 'tasdiqlandi') {
      throw new AppError('Tasdiqlangan kunlik yozuvni o\'chirib bo\'lmaydi', 400);
    }
    await client.query('DELETE FROM amaliyot_kundalik WHERE id = $1', [k.id]);
    await audit({ client, req, amal: 'amaliyot.kundalik_delete', obyekt: 'amaliyot_kundalik', obyektId: k.id, eski: k });
    return k.biriktirish_id;
  });
}

async function upsertKundalik({ biriktirishId, sana, ishMazmuni, soat, natija }, studentId, req) {
  return db.tx(async (client) => {
    const { rows: [b] } = await client.query(
      'SELECT * FROM amaliyot_biriktirishlar WHERE id = $1 FOR UPDATE',
      [biriktirishId],
    );
    if (!b) throw notFound('Amaliyot topilmadi');
    if (b.student_id !== studentId) throw forbidden();
    if (b.holat !== 'faol') throw new AppError('Faqat faol amaliyot uchun kundalik yozuvi kiritiladi', 400);
    if (sana < b.boshlanish_sana || sana > b.tugash_sana) {
      throw new AppError(`Sana amaliyot muddati (${b.boshlanish_sana} — ${b.tugash_sana}) oralig'ida bo'lishi kerak`, 400);
    }

    const { rows: [existing] } = await client.query(
      'SELECT * FROM amaliyot_kundalik WHERE biriktirish_id = $1 AND sana = $2',
      [b.id, sana],
    );
    if (existing && existing.ustoz_holat === 'tasdiqlandi' && existing.mentor_holat === 'tasdiqlandi') {
      throw new AppError('Ustoz va mentor tomonidan tasdiqlangan yozuvni o\'zgartirib bo\'lmaydi', 400);
    }

    const { rows: [saved] } = await client.query(
      `INSERT INTO amaliyot_kundalik (biriktirish_id, sana, ish_mazmuni, soat, natija)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (biriktirish_id, sana) DO UPDATE SET
         ish_mazmuni = EXCLUDED.ish_mazmuni,
         soat = EXCLUDED.soat,
         natija = EXCLUDED.natija,
         ustoz_holat = CASE WHEN amaliyot_kundalik.ustoz_holat = 'qaytarildi' THEN 'kutilmoqda' ELSE amaliyot_kundalik.ustoz_holat END,
         mentor_holat = CASE WHEN amaliyot_kundalik.mentor_holat = 'qaytarildi' THEN 'kutilmoqda' ELSE amaliyot_kundalik.mentor_holat END,
         updated_at = now()
       RETURNING *`,
      [b.id, sana, ishMazmuni, soat, natija || null],
    );
    await audit({ client, req, amal: 'amaliyot.kundalik_save', obyekt: 'amaliyot_kundalik', obyektId: saved.id, yangi: saved });
    return saved;
  });
}

async function upsertXulosa(data, studentId, req) {
  return db.tx(async (client) => {
    const { rows: [b] } = await client.query('SELECT * FROM amaliyot_biriktirishlar WHERE id = $1', [data.biriktirishId]);
    if (!b) throw notFound('Amaliyot topilmadi');
    if (b.student_id !== studentId) throw forbidden();

    const talabaHolat = data.topshirish ? 'topshirildi' : 'qoralama';
    const { rows: [saved] } = await client.query(
      `INSERT INTO amaliyot_xulosalar
         (biriktirish_id, bolimlar_javobi, bajarilgan_ishlar_xulosasi, ozlashtirilgan_konikmalar,
          muammo_va_takliflar, yakuniy_xulosa, talaba_holat, talaba_topshirdi_vaqt)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::varchar, CASE WHEN $7::varchar = 'topshirildi' THEN now() ELSE NULL END)
       ON CONFLICT (biriktirish_id) DO UPDATE SET
         bolimlar_javobi = EXCLUDED.bolimlar_javobi,
         bajarilgan_ishlar_xulosasi = EXCLUDED.bajarilgan_ishlar_xulosasi,
         ozlashtirilgan_konikmalar = EXCLUDED.ozlashtirilgan_konikmalar,
         muammo_va_takliflar = EXCLUDED.muammo_va_takliflar,
         yakuniy_xulosa = EXCLUDED.yakuniy_xulosa,
         talaba_holat = EXCLUDED.talaba_holat,
         talaba_topshirdi_vaqt = COALESCE(amaliyot_xulosalar.talaba_topshirdi_vaqt, EXCLUDED.talaba_topshirdi_vaqt),
         ustoz_holat = CASE WHEN $7::varchar = 'topshirildi' AND amaliyot_xulosalar.ustoz_holat = 'qaytarildi' THEN 'kutilmoqda' ELSE amaliyot_xulosalar.ustoz_holat END,
         mentor_holat = CASE WHEN $7::varchar = 'topshirildi' AND amaliyot_xulosalar.mentor_holat = 'qaytarildi' THEN 'kutilmoqda' ELSE amaliyot_xulosalar.mentor_holat END,
         updated_at = now()
       RETURNING *`,
      [
        b.id,
        JSON.stringify(data.bolimlarJavobi || {}),
        data.bajarilganIshlar || null,
        data.konikmalar || null,
        data.muammoTakliflar || null,
        data.yakuniyXulosa || null,
        talabaHolat,
      ],
    );
    if (talabaHolat === 'topshirildi') {
      await notify(client, b.ustoz_id, 'Talaba amaliyot xulosalar kitobchasini tasdiqlash uchun topshirdi.');
    }
    await audit({ client, req, amal: 'amaliyot.xulosa_save', obyekt: 'amaliyot_xulosalar', obyektId: saved.id, yangi: { talaba_holat: talabaHolat } });
    return saved;
  });
}

async function reviewKundalikByUstoz({ kundalikId, holat, izoh }, actor, req) {
  const { rows: [k] } = await db.query('SELECT * FROM amaliyot_kundalik WHERE id = $1', [kundalikId]);
  if (!k) throw notFound('Kundalik yozuvi topilmadi');
  const b = await getBiriktirishDetail(k.biriktirish_id);
  await assertBiriktirishAccess(actor, b, req, 'manage');

  return db.tx(async (client) => {
    const { rows: [updated] } = await client.query(
      `UPDATE amaliyot_kundalik
          SET ustoz_holat = $1,
              ustoz_izoh = $2,
              ustoz_tasdiqlagan_vaqt = now(),
              updated_at = now()
        WHERE id = $3 RETURNING *`,
      [holat, izoh || null, k.id],
    );
    if (holat === 'qaytarildi') {
      await notify(client, b.student_id, `${k.sana} kunlik yozuvi ustoz tomonidan qaytarildi${izoh ? `: ${izoh}` : '.'}`);
    }
    await audit({ client, req, amal: 'amaliyot.kundalik_ustoz_review', obyekt: 'amaliyot_kundalik', obyektId: k.id, eski: { ustoz_holat: k.ustoz_holat }, yangi: { ustoz_holat: holat } });
    return { updated, biriktirishId: b.id };
  });
}

async function approveAllKundalikByUstoz(biriktirishId, actor, req) {
  const b = await getBiriktirishDetail(biriktirishId);
  await assertBiriktirishAccess(actor, b, req, 'manage');
  return db.tx(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE amaliyot_kundalik
          SET ustoz_holat = 'tasdiqlandi', ustoz_tasdiqlagan_vaqt = now(), updated_at = now()
        WHERE biriktirish_id = $1 AND ustoz_holat = 'kutilmoqda'`,
      [b.id],
    );
    await audit({ client, req, amal: 'amaliyot.kundalik_ustoz_batch', obyekt: 'amaliyot_biriktirishlar', obyektId: b.id, yangi: { tasdiqlandi: rowCount } });
    return rowCount;
  });
}

async function reviewXulosaByUstoz({ xulosaId, holat, izoh, baho }, actor, req) {
  const { rows: [x] } = await db.query('SELECT * FROM amaliyot_xulosalar WHERE id = $1', [xulosaId]);
  if (!x) throw notFound('Xulosalar kitobchasi topilmadi');
  const b = await getBiriktirishDetail(x.biriktirish_id);
  await assertBiriktirishAccess(actor, b, req, 'manage');

  return db.tx(async (client) => {
    const { rows: [updated] } = await client.query(
      `UPDATE amaliyot_xulosalar
          SET ustoz_holat = $1,
              ustoz_izoh = $2,
              ustoz_baho = $3,
              ustoz_tasdiqlagan_vaqt = now(),
              updated_at = now()
        WHERE id = $4 RETURNING *`,
      [holat, izoh || null, baho ?? null, x.id],
    );
    await notify(client, b.student_id, `Xulosalar kitobchasi bo'yicha ustoz qarori: ${holat}${baho !== null && baho !== undefined ? ` (baho: ${baho})` : ''}.`);
    await audit({ client, req, amal: 'amaliyot.xulosa_ustoz_review', obyekt: 'amaliyot_xulosalar', obyektId: x.id, yangi: { ustoz_holat: holat, baho } });
    return { updated, biriktirishId: b.id };
  });
}

async function registerMentor(data, req) {
  return db.tx(async (client) => {
    await freezeExpiredMentors(client, req);

    const { rows: [ustoz] } = await client.query(
      "SELECT id, familiya, ism FROM users WHERE id = $1 AND status = TRUE AND role IN ('teacher', 'dekanat')",
      [data.ustozId],
    );
    if (!ustoz) throw new AppError('Biriktiriladigan ustoz topilmadi', 400);

    const { rows: [existing] } = await client.query(
      `SELECT id, holat FROM amaliyot_mentorlar
        WHERE lower(email) = lower($1) OR ($2::varchar IS NOT NULL AND google_sub = $2)`,
      [data.email, data.googleSub || null],
    );
    if (existing) {
      if (existing.holat === 'kutilmoqda') {
        throw new AppError('Bu Google akkaunt bilan ariza allaqachon yuborilgan va ustoz tasdig\'ini kutmoqda', 400);
      }
      if (existing.holat === 'muzlatilgan') {
        throw new AppError('Bu mentor akkauntining bir martalik muddati tugagan va muzlatilgan. Qayta faollashtirish uchun ustozga murojaat qiling.', 403);
      }
      if (existing.holat === 'rad_etildi') {
        throw new AppError('Bu mentor arizasi ustoz tomonidan rad etilgan', 403);
      }
      throw new AppError('Bu Google akkaunt allaqachon tasdiqlangan — mentor kirish sahifasidan kiring', 400);
    }

    let korxonaId = data.korxonaId || null;
    if (korxonaId) {
      const { rows: [k] } = await client.query('SELECT id FROM amaliyot_korxonalar WHERE id = $1', [korxonaId]);
      if (!k) korxonaId = null;
    }

    const { rows: [mentor] } = await client.query(
      `INSERT INTO amaliyot_mentorlar
         (korxona_id, korxona_nomi_kiritilgan, ustoz_id, ism, familiya, ochestva, lavozim, email, google_sub, telefon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        korxonaId,
        data.korxonaNomi || null,
        ustoz.id,
        data.ism,
        data.familiya,
        data.ochestva || null,
        data.lavozim || null,
        data.email.toLowerCase(),
        data.googleSub || null,
        data.telefon || null,
      ],
    );

    await notify(
      client,
      ustoz.id,
      `Yangi korxona mentori ro'yxatdan o'tdi: ${mentor.familiya} ${mentor.ism} (${mentor.email}). Tasdiqlash va muddat belgilash uchun /amaliyot/ustoz sahifasiga kiring.`,
    );
    await audit({ client, req, userId: null, amal: 'amaliyot.mentor_register', obyekt: 'amaliyot_mentorlar', obyektId: mentor.id, yangi: { email: mentor.email, ustoz_id: ustoz.id } });
    return mentor;
  });
}

function computeExpiryIntervalSql(muddatVal, birlik = 'kun') {
  const val = Number(muddatVal || 14);
  if (birlik === 'daqiqa') {
    if (!Number.isInteger(val) || val < 1 || val > 1440) {
      throw new AppError('Bir martalik amal qilish muddati 1 dan 1440 daqiqagacha bo\'lishi kerak', 400);
    }
    return { val, storedDays: 1, intervalSql: 'now() + make_interval(mins => $2)', unit: 'daqiqa' };
  }
  if (birlik === 'soat') {
    if (!Number.isInteger(val) || val < 1 || val > 720) {
      throw new AppError('Bir martalik amal qilish muddati 1 dan 720 soatgacha bo\'lishi kerak', 400);
    }
    return { val, storedDays: Math.max(1, Math.ceil(val / 24)), intervalSql: 'now() + make_interval(hours => $2)', unit: 'soat' };
  }
  if (!Number.isInteger(val) || val < 1 || val > 365) {
    throw new AppError('Bir martalik amal qilish muddati 1 dan 365 kungacha bo\'lishi kerak', 400);
  }
  return { val, storedDays: val, intervalSql: 'now() + make_interval(days => $2)', unit: 'kun' };
}

async function resolveOrCreateMentorKorxona(client, m, selectedKorxonaId, actorId) {
  let korxonaId = selectedKorxonaId || m.korxona_id;
  if (korxonaId) {
    const { rows: [k] } = await client.query('SELECT id FROM amaliyot_korxonalar WHERE id = $1', [korxonaId]);
    if (!k) korxonaId = null;
  }
  if (!korxonaId && m.korxona_nomi_kiritilgan) {
    const { rows: [found] } = await client.query(
      'SELECT id FROM amaliyot_korxonalar WHERE lower(nomi) = lower($1)',
      [m.korxona_nomi_kiritilgan.trim()],
    );
    if (found) {
      korxonaId = found.id;
    } else {
      const { rows: [newK] } = await client.query(
        'INSERT INTO amaliyot_korxonalar (nomi, yaratgan_id) VALUES ($1, $2) RETURNING id',
        [m.korxona_nomi_kiritilgan.trim(), actorId],
      );
      korxonaId = newK.id;
    }
  }
  return korxonaId;
}

async function reviewMentorByUstoz({ mentorId, action, muddatKun, muddatBirlik = 'kun', korxonaId: selectedKorxonaId = null, radSababi }, actor, req) {
  return db.tx(async (client) => {
    const { rows: [m] } = await client.query('SELECT * FROM amaliyot_mentorlar WHERE id = $1 FOR UPDATE', [mentorId]);
    if (!m) throw notFound('Mentor topilmadi');
    if (actor.role === 'teacher' && m.ustoz_id !== actor.id) {
      throw forbidden('Bu mentor boshqa ustozga biriktirilgan');
    }

    if (action === 'tasdiqlash') {
      if (m.holat !== 'kutilmoqda') {
        throw new AppError('Faqat tasdiqlash kutilayotgan mentor arizasini bir martalik faollashtirish mumkin', 400);
      }
      const { val, storedDays, intervalSql, unit } = computeExpiryIntervalSql(muddatKun, muddatBirlik);
      const korxonaId = await resolveOrCreateMentorKorxona(client, m, selectedKorxonaId, actor.id);
      const { rows: [updated] } = await client.query(
        `UPDATE amaliyot_mentorlar
            SET holat = 'tasdiqlandi',
                korxona_id = COALESCE($1, korxona_id),
                bir_martalik_muddat_kun = $3,
                amal_qilish_gacha = ${intervalSql},
                tasdiqlagan_id = $4,
                tasdiqlangan_vaqt = now(),
                muzlatilgan_vaqt = NULL,
                rad_sababi = NULL,
                updated_at = now()
          WHERE id = $5 RETURNING *`,
        [korxonaId, val, storedDays, actor.id, m.id],
      );
      await audit({
        client,
        req,
        amal: 'amaliyot.mentor_approve',
        obyekt: 'amaliyot_mentorlar',
        obyektId: m.id,
        eski: { holat: m.holat },
        yangi: { holat: 'tasdiqlandi', muddat: val, birlik: unit },
      });
      return updated;
    }

    if (action === 'muddat_yangilash') {
      if (m.holat !== 'tasdiqlandi') {
        throw new AppError('Faqat faol tasdiqlangan mentor muddatini o\'zgartirish mumkin', 400);
      }
      const { val, storedDays, intervalSql, unit } = computeExpiryIntervalSql(muddatKun, muddatBirlik);
      const { rows: [updated] } = await client.query(
        `UPDATE amaliyot_mentorlar
            SET bir_martalik_muddat_kun = $1,
                amal_qilish_gacha = ${intervalSql},
                updated_at = now()
          WHERE id = $3 RETURNING *`,
        [storedDays, val, m.id],
      );
      await audit({
        client,
        req,
        amal: 'amaliyot.mentor_duration_update',
        obyekt: 'amaliyot_mentorlar',
        obyektId: m.id,
        eski: { amal_qilish_gacha: m.amal_qilish_gacha },
        yangi: { muddat: val, birlik: unit },
      });
      return updated;
    }

    if (action === 'rad_etish') {
      const { rows: [updated] } = await client.query(
        `UPDATE amaliyot_mentorlar
            SET holat = 'rad_etildi', rad_sababi = $1, updated_at = now()
          WHERE id = $2 RETURNING *`,
        [radSababi || 'Ustoz tomonidan rad etildi', m.id],
      );
      await audit({ client, req, amal: 'amaliyot.mentor_reject', obyekt: 'amaliyot_mentorlar', obyektId: m.id, eski: { holat: m.holat }, yangi: { holat: 'rad_etildi' } });
      return updated;
    }

    if (action === 'muzlatish') {
      const { rows: [updated] } = await client.query(
        `UPDATE amaliyot_mentorlar
            SET holat = 'muzlatilgan', muzlatilgan_vaqt = now(), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [m.id],
      );
      await audit({ client, req, amal: 'amaliyot.mentor_freeze', obyekt: 'amaliyot_mentorlar', obyektId: m.id, eski: { holat: m.holat }, yangi: { holat: 'muzlatilgan' } });
      return updated;
    }

    throw new AppError('Noto\'g\'ri amal', 400);
  });
}

async function approveAllPendingMentorsByUstoz({ muddatKun = 14, muddatBirlik = 'kun' }, actor, req) {
  const { val, storedDays, intervalSql, unit } = computeExpiryIntervalSql(muddatKun, muddatBirlik);
  return db.tx(async (client) => {
    const isTeacher = actor.role === 'teacher';
    const { rows: pending } = await client.query(
      `SELECT * FROM amaliyot_mentorlar
        WHERE holat = 'kutilmoqda' AND ($1::boolean OR ustoz_id = $2)
        FOR UPDATE`,
      [!isTeacher, actor.id],
    );
    for (const m of pending) {
      const korxonaId = await resolveOrCreateMentorKorxona(client, m, null, actor.id);
      await client.query(
        `UPDATE amaliyot_mentorlar
            SET holat = 'tasdiqlandi',
                korxona_id = COALESCE($1, korxona_id),
                bir_martalik_muddat_kun = $3,
                amal_qilish_gacha = ${intervalSql},
                tasdiqlagan_id = $4,
                tasdiqlangan_vaqt = now(),
                muzlatilgan_vaqt = NULL,
                rad_sababi = NULL,
                updated_at = now()
          WHERE id = $5`,
        [korxonaId, val, storedDays, actor.id, m.id],
      );
    }
    if (pending.length) {
      await audit({
        client,
        req,
        amal: 'amaliyot.mentor_approve_all',
        obyekt: 'amaliyot_mentorlar',
        yangi: { soni: pending.length, muddat: val, birlik: unit },
      });
    }
    return pending.length;
  });
}

async function authenticateMentorByGoogle({ email, sub = null }, req) {
  await freezeExpiredMentors(db, req);
  const { rows: [m] } = await db.query(
    `SELECT * FROM amaliyot_mentorlar
      WHERE ($1::varchar IS NOT NULL AND google_sub = $1)
         OR lower(email) = lower($2)
      LIMIT 1`,
    [sub, email],
  );
  if (!m) return { status: 'not_found' };
  if (sub && !m.google_sub) {
    await db.query('UPDATE amaliyot_mentorlar SET google_sub = $1, updated_at = now() WHERE id = $2', [sub, m.id]);
  }
  if (m.holat === 'kutilmoqda') return { status: 'pending', mentor: m };
  if (m.holat === 'rad_etildi') return { status: 'rejected', mentor: m };
  if (m.holat === 'muzlatilgan') return { status: 'frozen', mentor: m };
  if (m.holat === 'tasdiqlandi') return { status: 'ok', mentor: m };
  return { status: 'frozen', mentor: m };
}

async function getMentorDashboard(mentorId) {
  const { rows: biriktirishlar } = await db.query(
    `SELECT b.*,
            t.nomi AS tur_nomi, t.bolimlar_json,
            k.nomi AS korxona_nomi,
            trim(concat_ws(' ', st.familiya, st.ism, st.ochestva)) AS student_fio,
            si.guruh, si.kurs,
            trim(concat_ws(' ', us.familiya, us.ism)) AS ustoz_fio,
            x.id AS xulosa_id, x.talaba_holat, x.bajarilgan_ishlar_xulosasi, x.ozlashtirilgan_konikmalar,
            x.muammo_va_takliflar, x.yakuniy_xulosa, x.mentor_holat AS xulosa_mentor_holat, x.mentor_fikr AS xulosa_mentor_fikr
       FROM amaliyot_biriktirishlar b
       JOIN amaliyot_turlar t ON t.id = b.tur_id
       JOIN amaliyot_korxonalar k ON k.id = b.korxona_id
       JOIN users st ON st.id = b.student_id
       LEFT JOIN student_info si ON si.user_id = st.id
       JOIN users us ON us.id = b.ustoz_id
       LEFT JOIN amaliyot_xulosalar x ON x.biriktirish_id = b.id
      WHERE b.mentor_id = $1
      ORDER BY (b.holat = 'faol') DESC, b.id DESC`,
    [mentorId],
  );

  for (const b of biriktirishlar) {
    b.kundaliklar = (await db.query(
      'SELECT * FROM amaliyot_kundalik WHERE biriktirish_id = $1 ORDER BY sana DESC, id DESC',
      [b.id],
    )).rows;
  }
  return biriktirishlar;
}

async function reviewKundalikByMentor({ kundalikId, holat, fikr }, mentor, req) {
  const { rows: [k] } = await db.query('SELECT * FROM amaliyot_kundalik WHERE id = $1', [kundalikId]);
  if (!k) throw notFound('Kundalik yozuvi topilmadi');
  const b = await getBiriktirishDetail(k.biriktirish_id);
  if (b.mentor_id !== mentor.id) throw forbidden('Bu talaba sizga biriktirilmagan');

  return db.tx(async (client) => {
    const { rows: [updated] } = await client.query(
      `UPDATE amaliyot_kundalik
          SET mentor_holat = $1,
              mentor_fikr = $2,
              mentor_tasdiqlagan_vaqt = now(),
              updated_at = now()
        WHERE id = $3 RETURNING *`,
      [holat, fikr || null, k.id],
    );
    if (holat === 'qaytarildi' || fikr) {
      await notify(client, b.student_id, `Korxona mentori ${k.sana} kundalik yozuviga "${holat}" holatini qo'ydi${fikr ? ` (Fikr: ${fikr})` : ''}.`);
    }
    await audit({ client, req, userId: null, amal: 'amaliyot.kundalik_mentor_review', obyekt: 'amaliyot_kundalik', obyektId: k.id, yangi: { mentor_id: mentor.id, mentor_holat: holat } });
    return updated;
  });
}

async function approveAllKundalikByMentor(biriktirishId, mentor, fikr, req) {
  const b = await getBiriktirishDetail(biriktirishId);
  if (b.mentor_id !== mentor.id) throw forbidden('Bu talaba sizga biriktirilmagan');
  return db.tx(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE amaliyot_kundalik
          SET mentor_holat = 'tasdiqlandi',
              mentor_fikr = COALESCE(NULLIF($2::text, ''), mentor_fikr),
              mentor_tasdiqlagan_vaqt = now(),
              updated_at = now()
        WHERE biriktirish_id = $1 AND mentor_holat = 'kutilmoqda'`,
      [b.id, fikr || ''],
    );
    if (rowCount > 0 && fikr) {
      await notify(client, b.student_id, `Korxona mentori ${rowCount} ta kundalik yozuvingizni tasdiqladi (Fikr: ${fikr}).`);
    }
    await audit({ client, req, userId: null, amal: 'amaliyot.kundalik_mentor_batch', obyekt: 'amaliyot_biriktirishlar', obyektId: b.id, yangi: { mentor_id: mentor.id, tasdiqlandi: rowCount } });
    return rowCount;
  });
}

async function reviewXulosaByMentor({ xulosaId, holat, fikr }, mentor, req) {
  const { rows: [x] } = await db.query('SELECT * FROM amaliyot_xulosalar WHERE id = $1', [xulosaId]);
  if (!x) throw notFound('Xulosalar kitobchasi topilmadi');
  const b = await getBiriktirishDetail(x.biriktirish_id);
  if (b.mentor_id !== mentor.id) throw forbidden('Bu talaba sizga biriktirilmagan');

  return db.tx(async (client) => {
    const { rows: [updated] } = await client.query(
      `UPDATE amaliyot_xulosalar
          SET mentor_holat = $1,
              mentor_fikr = $2,
              mentor_tasdiqlagan_vaqt = now(),
              updated_at = now()
        WHERE id = $3 RETURNING *`,
      [holat, fikr || null, x.id],
    );
    await notify(client, b.student_id, `Korxona mentori xulosalar kitobchasini "${holat}" deb belgiladi.`);
    await audit({ client, req, userId: null, amal: 'amaliyot.xulosa_mentor_review', obyekt: 'amaliyot_xulosalar', obyektId: x.id, yangi: { mentor_id: mentor.id, mentor_holat: holat } });
    return updated;
  });
}

async function createTur({ kod, nomi, tavsif, kunlikMinSoat, bolimlar }, actor, req) {
  const { rows: [dup] } = await db.query('SELECT id FROM amaliyot_turlar WHERE lower(kod) = lower($1)', [kod]);
  if (dup) throw new AppError('Bu koddagi amaliyot turi allaqachon mavjud', 400);
  const { rows: [created] } = await db.query(
    `INSERT INTO amaliyot_turlar (kod, nomi, tavsif, kunlik_min_soat, bolimlar_json)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [kod, nomi, tavsif || null, kunlikMinSoat, JSON.stringify(bolimlar)],
  );
  await audit({ req, amal: 'amaliyot.tur_create', obyekt: 'amaliyot_turlar', obyektId: created.id, yangi: created });
  return created;
}

async function updateTur(turId, { nomi, tavsif, kunlikMinSoat, bolimlar }, actor, req) {
  const { rows: [old] } = await db.query('SELECT * FROM amaliyot_turlar WHERE id = $1', [turId]);
  if (!old) throw notFound('Amaliyot turi topilmadi');
  const { rows: [updated] } = await db.query(
    `UPDATE amaliyot_turlar
        SET nomi = $1,
            tavsif = $2,
            kunlik_min_soat = $3,
            bolimlar_json = $4::jsonb
      WHERE id = $5 RETURNING *`,
    [nomi, tavsif || null, kunlikMinSoat, JSON.stringify(bolimlar), turId],
  );
  await audit({ req, amal: 'amaliyot.tur_update', obyekt: 'amaliyot_turlar', obyektId: turId, eski: old, yangi: updated });
  return updated;
}

async function toggleTurStatus(turId, req) {
  const { rows: [t] } = await db.query(
    'UPDATE amaliyot_turlar SET faol = NOT faol WHERE id = $1 RETURNING *',
    [turId],
  );
  if (!t) throw notFound('Amaliyot turi topilmadi');
  await audit({ req, amal: 'amaliyot.tur_toggle', obyekt: 'amaliyot_turlar', obyektId: t.id, yangi: { faol: t.faol } });
  return t;
}

module.exports = {
  getTurlar,
  getKorxonalar,
  getUstozlar,
  getBiriktirishDetail,
  getBiriktirishFull,
  assertBiriktirishAccess,
  getStudentDashboard,
  getUstozDashboard,
  createKorxona,
  createBiriktirish,
  updateBiriktirish,
  changeDiaryType,
  assignMentorToBiriktirish,
  upsertKundalik,
  deleteKundalik,
  upsertXulosa,
  reviewKundalikByUstoz,
  approveAllKundalikByUstoz,
  reviewXulosaByUstoz,
  registerMentor,
  reviewMentorByUstoz,
  approveAllPendingMentorsByUstoz,
  authenticateMentorByGoogle,
  getMentorDashboard,
  reviewKundalikByMentor,
  approveAllKundalikByMentor,
  reviewXulosaByMentor,
  createTur,
  updateTur,
  toggleTurStatus,
};
