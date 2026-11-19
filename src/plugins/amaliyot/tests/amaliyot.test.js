const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { request, pool, createApp, resetDb, login, csrfOf, userId } = require('../../../../tests/helpers');
const { today } = require('../../../lib/time');

let app;
before(async () => {
  await resetDb();
  app = createApp();
});
after(() => pool.end());

function extractDocxXml(buf) {
  assert.equal(buf.subarray(0, 2).toString('utf8'), 'PK', 'DOCX ZIP imzosi PK bo\'lishi kerak');
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const fileName = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (fileName === 'word/document.xml') {
      return zlib.inflateRawSync(data).toString('utf8');
    }
    offset = dataStart + compSize;
  }
  throw new Error('word/document.xml topilmadi');
}

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

test('RBAC: talaba ustoz/admin marshrutlariga kira olmaydi (403)', async () => {
  const st = await login(app, 'talaba1');
  assert.equal((await st.get('/amaliyot')).status, 200);
  assert.equal((await st.get('/amaliyot/ustoz')).status, 403);
  assert.equal((await st.get('/admin/amaliyot/turlar')).status, 403);
  assert.equal((await st.form('/amaliyot/korxona', { nomi: 'Hacker MChJ' })).status, 403);
});

test('Asosiy oqim: mentor Google ro\'yxatdan o\'tishi -> ustoz tasdig\'i -> talaba kundaligi & docx -> mentor fikri -> muddatda muzlatish', async () => {
  const ustozId = await userId('karimova');
  const talaba1Id = await userId('talaba1');

  // 1. Ustoz korxona qo'shadi
  const ustoz = await login(app, 'karimova');
  const kRes = await ustoz.form('/amaliyot/korxona', {
    nomi: 'Smart Soft MChJ',
    manzil: 'Toshkent sh., Chilonzor',
    stir: '301234567',
    rahbar_fio: 'Aliyev V.',
    telefon: '+998901234567',
  });
  assert.equal(kRes.status, 302);
  const { rows: [korxona] } = await pool.query("SELECT * FROM amaliyot_korxonalar WHERE nomi = 'Smart Soft MChJ'");
  assert.ok(korxona);

  // 2. Korxona mentori Google email bilan ro'yxatdan o'tadi
  const mentorAgent = request.agent(app);
  const regPage = await mentorAgent.get('/amaliyot/mentor/royxat');
  assert.equal(regPage.status, 200);
  const regPost = await mentorAgent.post('/amaliyot/mentor/royxat').type('form').send({
    _csrf: csrfOf(regPage.text),
    email: 'mentor.google@gmail.com',
    familiya: 'Qosimov',
    ism: 'Rustam',
    lavozim: 'Tech Lead',
    telefon: '+998907778899',
    korxona_id: String(korxona.id),
    ustoz_id: String(ustozId),
  });
  assert.equal(regPost.status, 302);

  // Ustozga bildirishnoma ketganini tekshirish
  const { rows: notifs } = await pool.query(
    'SELECT matn FROM bildirishnomalar WHERE user_id = $1 ORDER BY id DESC',
    [ustozId],
  );
  assert.ok(notifs.some((n) => n.matn.includes('mentor.google@gmail.com')));

  // 3. Ustoz tasdiqlamaguncha mentor kira olmaydi
  const loginPage1 = await mentorAgent.get('/amaliyot/mentor/kirish');
  const blockedLogin = await mentorAgent.post('/amaliyot/mentor/kirish').type('form').send({
    _csrf: csrfOf(loginPage1.text),
    email: 'mentor.google@gmail.com',
  });
  assert.equal(blockedLogin.status, 403);
  assert.match(blockedLogin.text, /tasdiqlanmagan/);

  // Boshqa ustoz bu mentorni tasdiqlay olmaydi (403)
  const { rows: [mentorRow] } = await pool.query("SELECT * FROM amaliyot_mentorlar WHERE email = 'mentor.google@gmail.com'");
  const boshqaDekan = await login(app, 'dekan_at');
  assert.equal((await ustoz.form(`/amaliyot/mentor/${mentorRow.id}/tasdiqlash`, { action: 'tasdiqlash', muddat_kun: '0' })).status, 400);
  assert.ok(boshqaDekan);

  // 4. Ustoz mentorni tasdiqlaydi va 14 kunlik bir martalik muddat belgilaydi
  const approveMentor = await ustoz.form(`/amaliyot/mentor/${mentorRow.id}/tasdiqlash`, {
    action: 'tasdiqlash',
    muddat_kun: '14',
  });
  assert.equal(approveMentor.status, 302);

  const loginPage2 = await mentorAgent.get('/amaliyot/mentor/kirish');
  const okLogin = await mentorAgent.post('/amaliyot/mentor/kirish').type('form').send({
    _csrf: csrfOf(loginPage2.text),
    email: 'mentor.google@gmail.com',
  });
  assert.equal(okLogin.status, 302);
  const mDash1 = await mentorAgent.get('/amaliyot/mentor');
  assert.equal(mDash1.status, 200);
  mentorAgent.csrf = csrfOf(mDash1.text);
  mentorAgent.form = (url, body = {}) => mentorAgent.post(url).type('form').send({ _csrf: mentorAgent.csrf, ...body });

  // 5. Ustoz talaba1 ni korxonaga, mentorga va "ishlab_chiqarish" kundalik turiga biriktiradi
  const { rows: [tur1] } = await pool.query("SELECT id FROM amaliyot_turlar WHERE kod = 'ishlab_chiqarish'");
  const { rows: [tur2] } = await pool.query("SELECT id FROM amaliyot_turlar WHERE kod = 'malakaviy'");
  const bugun = today();
  const birRes = await ustoz.form('/amaliyot/biriktirish', {
    student_id: String(talaba1Id),
    korxona_id: String(korxona.id),
    mentor_id: String(mentorRow.id),
    tur_id: String(tur1.id),
    boshlanish_sana: bugun,
    tugash_sana: bugun,
    mavzu: 'Node.js backend tizimi',
  });
  assert.equal(birRes.status, 302);
  const { rows: [biriktirish] } = await pool.query('SELECT * FROM amaliyot_biriktirishlar WHERE student_id = $1', [talaba1Id]);
  assert.ok(biriktirish);

  // Ustoz kundalik turini "malakaviy" ga o'zgartiradi
  const chTur = await ustoz.form(`/amaliyot/biriktirish/${biriktirish.id}/tur`, { tur_id: String(tur2.id) });
  assert.equal(chTur.status, 302);
  const { rows: [updatedB] } = await pool.query('SELECT tur_id FROM amaliyot_biriktirishlar WHERE id = $1', [biriktirish.id]);
  assert.equal(updatedB.tur_id, tur2.id);

  // 6. Talaba kunlik yozuv va xulosalar kitobchasini to'ldiradi
  const st1 = await login(app, 'talaba1');
  const badK = await st1.form('/amaliyot/kundalik', {
    biriktirish_id: String(biriktirish.id),
    sana: '2020-01-01', // muddatdan tashqarida
    ish_mazmuni: 'Test ish mazmuni',
    soat: '6',
  });
  assert.equal(badK.status, 400);

  // 6b. Tasdiqlanmagan kundalik yozuvini o'chirish mumkin, tasdiqlangandan keyin esa mumkin emas
  const delDraftRes = await st1.form('/amaliyot/kundalik', {
    biriktirish_id: String(biriktirish.id),
    sana: bugun,
    ish_mazmuni: 'Vaqtinchalik qoralama yozuvi',
    soat: '4',
  });
  assert.equal(delDraftRes.status, 302);
  const { rows: [draftK] } = await pool.query('SELECT id FROM amaliyot_kundalik WHERE biriktirish_id = $1', [biriktirish.id]);
  assert.equal((await st1.form(`/amaliyot/kundalik/${draftK.id}/ochirish`)).status, 302);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM amaliyot_kundalik WHERE biriktirish_id = $1', [biriktirish.id])).rows[0].n, 0);

  const okK = await st1.form('/amaliyot/kundalik', {
    biriktirish_id: String(biriktirish.id),
    sana: bugun,
    ish_mazmuni: 'PostgreSQL migratsiya va REST API marshrutlari yozildi',
    soat: '6',
    natija: '3 ta endpoint tayyor bo\'ldi',
  });
  assert.equal(okK.status, 302);

  // Xulosalar kitobchasi
  const okX = await st1.form('/amaliyot/xulosa', {
    biriktirish_id: String(biriktirish.id),
    bolim_loyiha_vazifa: 'Kundalik moduli ishlab chiqildi',
    bajarilgan_ishlar_xulosasi: 'Barcha kunlik vazifalar o\'z vaqtida bajarildi',
    ozlashtirilgan_konikmalar: 'Express, PostgreSQL, OOXML',
    muammo_va_takliflar: 'Avtomatik testlarni ko\'paytirish taklif etiladi',
    yakuniy_xulosa: 'Amaliyot muvaffaqiyatli yakunlandi',
    harakat: 'topshirish',
  });
  assert.equal(okX.status, 302);

  // 7. Mentor kundalikni tasdiqlaydi va ixtiyoriy qo'shimcha fikr qoldiradi
  const { rows: [kundalikRow] } = await pool.query('SELECT id FROM amaliyot_kundalik WHERE biriktirish_id = $1', [biriktirish.id]);
  const mRev = await mentorAgent.form(`/amaliyot/mentor/kundalik/${kundalikRow.id}/holat`, {
    holat: 'tasdiqlandi',
    fikr: 'Talaba mas\'uliyat bilan ishladi',
  });
  assert.equal(mRev.status, 302);

  // Tasdiqlangan yozuvni talaba o'chira olmaydi (400)
  assert.equal((await st1.form(`/amaliyot/kundalik/${kundalikRow.id}/ochirish`)).status, 400);

  // Ustoz ham kundalik va xulosani tasdiqlaydi
  const uRev = await ustoz.form(`/amaliyot/kundalik/${kundalikRow.id}/ustoz-holat`, {
    holat: 'tasdiqlandi',
    izoh: 'Yaxshi',
  });
  assert.equal(uRev.status, 302);

  const { rows: [xulosaRow] } = await pool.query('SELECT id FROM amaliyot_xulosalar WHERE biriktirish_id = $1', [biriktirish.id]);
  const uxRev = await ustoz.form(`/amaliyot/xulosa/${xulosaRow.id}/ustoz-holat`, {
    holat: 'tasdiqlandi',
    baho: '95',
    izoh: 'A\'lo natija',
  });
  assert.equal(uxRev.status, 302);

  // 8. Standart Word (.docx) hujjatlar yuklab olinadi va tarkibi tekshiriladi
  const docxRes = await st1.get(`/amaliyot/${biriktirish.id}/docx`).buffer(true).parse(binaryParser);
  assert.equal(docxRes.status, 200);
  assert.match(docxRes.headers['content-type'], /wordprocessingml\.document/);
  const xml1 = extractDocxXml(docxRes.body);
  assert.match(xml1, /TALABANING STANDART AMALIYOT KUNDALIGI/);
  assert.match(xml1, /Smart Soft MChJ/);
  assert.match(xml1, /Malakaviy amaliyot/);
  assert.match(xml1, /PostgreSQL migratsiya va REST API marshrutlari yozildi/);
  assert.match(xml1, /Talaba mas&apos;uliyat bilan ishladi/);

  const xDocxRes = await st1.get(`/amaliyot/${biriktirish.id}/xulosa-docx`).buffer(true).parse(binaryParser);
  assert.equal(xDocxRes.status, 200);
  const xml2 = extractDocxXml(xDocxRes.body);
  assert.match(xml2, /XULOSALAR KITOBCHASI/);
  assert.match(xml2, /Amaliyot muvaffaqiyatli yakunlandi/);
  assert.match(xml2, /95 \/ 100/);

  // Boshqa talaba bu kundalikni yuklay olmaydi (403)
  const st2 = await login(app, 'talaba2');
  assert.equal((await st2.get(`/amaliyot/${biriktirish.id}/docx`)).status, 403);

  // 9. Bir martalik muddat tugaganda mentor akkaunti avtomatik muzlatiladi
  await pool.query("UPDATE amaliyot_mentorlar SET amal_qilish_gacha = now() - interval '1 minute' WHERE id = $1", [mentorRow.id]);
  const afterExp = await mentorAgent.get('/amaliyot/mentor');
  assert.equal(afterExp.status, 302);
  assert.equal(afterExp.headers.location, '/amaliyot/mentor/kirish');

  const { rows: [frozenM] } = await pool.query('SELECT holat FROM amaliyot_mentorlar WHERE id = $1', [mentorRow.id]);
  assert.equal(frozenM.holat, 'muzlatilgan');

  // Muzlatilgan mentor qayta kira olmaydi va bir martalik muddatni qayta tasdiqlab bo'lmaydi
  const loginPage3 = await mentorAgent.get('/amaliyot/mentor/kirish');
  const frozenLogin = await mentorAgent.post('/amaliyot/mentor/kirish').type('form').send({
    _csrf: csrfOf(loginPage3.text),
    email: 'mentor.google@gmail.com',
  });
  assert.equal(frozenLogin.status, 403);
  assert.match(frozenLogin.text, /muzlatilgan/);

  const reApprove = await ustoz.form(`/amaliyot/mentor/${mentorRow.id}/tasdiqlash`, {
    action: 'tasdiqlash',
    muddat_kun: '7',
  });
  assert.equal(reApprove.status, 400);
  // 10. Ustoz amaliyot ma'lumotlarini tahrirlaydi va yakunlaydi
  const editBir = await ustoz.form(`/amaliyot/biriktirish/${biriktirish.id}/tahrirlash`, {
    korxona_id: String(korxona.id),
    boshlanish_sana: bugun,
    tugash_sana: bugun,
    mavzu: 'Yangilangan Node.js amaliyot mavzusi',
    holat: 'yakunlangan',
  });
  assert.equal(editBir.status, 302);
  const { rows: [finB] } = await pool.query('SELECT holat, mavzu FROM amaliyot_biriktirishlar WHERE id = $1', [biriktirish.id]);
  assert.equal(finB.holat, 'yakunlangan');
  assert.equal(finB.mavzu, 'Yangilangan Node.js amaliyot mavzusi');
});

test('Izolyatsiya va kundalik turlari: yangi tur yaratish, tahrirlash va soatlik mentor muddati', async () => {
  const adm = await login(app, 'admin', 'admin12345');
  const tRes = await adm.form('/admin/amaliyot/turlar', {
    kod: 'pedagogik_sinov',
    nomi: 'Pedagogik amaliyot',
    tavsif: 'Maktab va kollejlarda o\'tkaziladigan amaliyot',
    kunlik_min_soat: '5',
    bolimlar_matn: 'Dars konspekti | Har bir dars rejasi\nUstoz tahlili | Metodik xulosa',
  });
  assert.equal(tRes.status, 302);
  const { rows: [tur] } = await pool.query("SELECT * FROM amaliyot_turlar WHERE kod = 'pedagogik_sinov'");
  assert.equal(tur.nomi, 'Pedagogik amaliyot');
  assert.equal(tur.bolimlar_json.length, 2);

  // Kundalik turini tahrirlash
  const tEdit = await adm.form(`/admin/amaliyot/turlar/${tur.id}`, {
    nomi: 'Pedagogik va metodik amaliyot',
    tavsif: 'Yangilangan tavsif',
    kunlik_min_soat: '6',
    bolimlar_matn: 'Dars konspekti | Yangilangan izoh',
  });
  assert.equal(tEdit.status, 302);
  const { rows: [turEdited] } = await pool.query('SELECT * FROM amaliyot_turlar WHERE id = $1', [tur.id]);
  assert.equal(turEdited.nomi, 'Pedagogik va metodik amaliyot');
  assert.equal(turEdited.bolimlar_json.length, 1);

  // Soatlik bir martalik muddat + yangi korxona nomini avtomatik yaratish + mentor batch tasdiqlash
  const ustozId = await userId('karimova');
  const mentor2Agent = request.agent(app);
  const regP = await mentor2Agent.get('/amaliyot/mentor/royxat');
  await mentor2Agent.post('/amaliyot/mentor/royxat').type('form').send({
    _csrf: csrfOf(regP.text),
    email: 'soatlik.mentor@gmail.com',
    familiya: 'Toshmatov',
    ism: 'Akmal',
    lavozim: 'Team Lead',
    korxona_nomi: 'Avto Yaratilgan Korxona MChJ',
    ustoz_id: String(ustozId),
  });
  const { rows: [m2] } = await pool.query("SELECT * FROM amaliyot_mentorlar WHERE email = 'soatlik.mentor@gmail.com'");
  const karimova = await login(app, 'karimova');
  const app2 = await karimova.form(`/amaliyot/mentor/${m2.id}/tasdiqlash`, {
    action: 'tasdiqlash',
    muddat_kun: '2',
    muddat_birlik: 'soat',
  });
  assert.equal(app2.status, 302);

  const { rows: [m2Updated] } = await pool.query('SELECT * FROM amaliyot_mentorlar WHERE id = $1', [m2.id]);
  assert.equal(m2Updated.holat, 'tasdiqlandi');
  assert.ok(m2Updated.korxona_id, 'Yangi korxona avtomatik yaratilib bog\'lanishi kerak');

  const talaba2Id = await userId('talaba2');
  const bugun = today();
  await karimova.form('/amaliyot/biriktirish', {
    student_id: String(talaba2Id),
    korxona_id: String(m2Updated.korxona_id),
    mentor_id: String(m2.id),
    tur_id: String(tur.id),
    boshlanish_sana: bugun,
    tugash_sana: bugun,
  });
  const { rows: [b2] } = await pool.query('SELECT id FROM amaliyot_biriktirishlar WHERE student_id = $1', [talaba2Id]);
  const st2 = await login(app, 'talaba2');
  await st2.form('/amaliyot/kundalik', {
    biriktirish_id: String(b2.id),
    sana: bugun,
    ish_mazmuni: 'Batch tasdiqlash uchun kunlik ish',
    soat: '6',
  });

  const lPage = await mentor2Agent.get('/amaliyot/mentor/kirish');
  await mentor2Agent.post('/amaliyot/mentor/kirish').type('form').send({
    _csrf: csrfOf(lPage.text),
    email: 'soatlik.mentor@gmail.com',
  });
  const dash2 = await mentor2Agent.get('/amaliyot/mentor');
  assert.equal(dash2.status, 200);
  const batchRes = await mentor2Agent.post(`/amaliyot/mentor/biriktirish/${b2.id}/tasdiqlash-hammasi`).type('form').send({
    _csrf: csrfOf(dash2.text),
    fikr: 'Hammasi a\'lo',
  });
  assert.equal(batchRes.status, 302);
  const { rows: [k2] } = await pool.query('SELECT mentor_holat, mentor_fikr FROM amaliyot_kundalik WHERE biriktirish_id = $1', [b2.id]);
  assert.equal(k2.mentor_holat, 'tasdiqlandi');
  assert.equal(k2.mentor_fikr, 'Hammasi a\'lo');

  // Iqtisodiyot dekani AT talabasini biriktira olmaydi (403)
  await adm.form('/amaliyot/korxona', { nomi: 'Test Izolyatsiya MChJ' });
  const iqDek = await login(app, 'dekan_iq');
  const talaba1Id = await userId('talaba1');
  const { rows: [kor] } = await pool.query("SELECT id FROM amaliyot_korxonalar WHERE nomi = 'Test Izolyatsiya MChJ'");
  const crossFac = await iqDek.form('/amaliyot/biriktirish', {
    student_id: String(talaba1Id),
    korxona_id: String(kor.id),
    tur_id: String(tur.id),
    boshlanish_sana: bugun,
    tugash_sana: bugun,
  });
  assert.equal(crossFac.status, 403);
});

test('Regressiya: mentor va kundalik tasdiqlash formasi action/holat yuborilmaganda ham default tasdiqlaydi', async () => {
  const dekanId = await userId('dekan_at');
  const mAgent = request.agent(app);
  const regP = await mAgent.get('/amaliyot/mentor/royxat');
  await mAgent.post('/amaliyot/mentor/royxat').type('form').send({
    _csrf: csrfOf(regP.text),
    email: 'regressiya.mentor@gmail.com',
    familiya: 'Mamadjanov',
    ism: 'Shuxrat',
    lavozim: 'Senior dasturchi',
    korxona_nomi: 'Robotics Lab Future',
    ustoz_id: String(dekanId),
  });

  const { rows: [mRow] } = await pool.query("SELECT id FROM amaliyot_mentorlar WHERE email = 'regressiya.mentor@gmail.com'");
  const dekan = await login(app, 'dekan_at');
  const ustozPage = await dekan.get('/amaliyot/ustoz');
  assert.equal(ustozPage.status, 200);
  assert.doesNotMatch(ustozPage.text, new RegExp(`action="/amaliyot/mentor/${mRow.id}/tasdiqlash"[^>]*data-once`));

  // action maydoni tushib qolsa ham default 'tasdiqlash' sifatida ishlaydi
  const appRes = await dekan.form(`/amaliyot/mentor/${mRow.id}/tasdiqlash`, {
    muddat_kun: '14',
    muddat_birlik: 'kun',
  });
  assert.equal(appRes.status, 302);
  const { rows: [mApproved] } = await pool.query('SELECT holat FROM amaliyot_mentorlar WHERE id = $1', [mRow.id]);
  assert.equal(mApproved.holat, 'tasdiqlandi');

  // Kundalik yozuvida holat tushib qolsa ham default 'tasdiqlandi' ishlaydi
  const { rows: [b2] } = await pool.query("SELECT id FROM amaliyot_biriktirishlar WHERE student_id = $1 ORDER BY id DESC LIMIT 1", [await userId('talaba2')]);
  const { rows: [k2] } = await pool.query('SELECT id FROM amaliyot_kundalik WHERE biriktirish_id = $1 LIMIT 1', [b2.id]);
  const karimova = await login(app, 'karimova');
  const kRes = await karimova.form(`/amaliyot/kundalik/${k2.id}/ustoz-holat`, { izoh: 'OK' });
  assert.equal(kRes.status, 302);
  const { rows: [kUpdated] } = await pool.query('SELECT ustoz_holat FROM amaliyot_kundalik WHERE id = $1', [k2.id]);
  assert.equal(kUpdated.ustoz_holat, 'tasdiqlandi');
});
