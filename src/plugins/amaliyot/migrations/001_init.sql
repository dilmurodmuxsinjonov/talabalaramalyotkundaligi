-- =====================================================================
-- Amaliyot kundaligi (amaliyot) plagini — boshlang'ich sxema
-- =====================================================================

-- 1. Amaliyot / kundalik turlari (ustoz tomonidan biriktirishda tanlanadi va o'zgartirilishi mumkin)
CREATE TABLE IF NOT EXISTS amaliyot_turlar (
  id              BIGSERIAL PRIMARY KEY,
  kod             VARCHAR(40)  NOT NULL,
  nomi            VARCHAR(150) NOT NULL,
  tavsif          TEXT,
  bolimlar_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  kunlik_min_soat NUMERIC(4,1) NOT NULL DEFAULT 6.0 CHECK (kunlik_min_soat > 0 AND kunlik_min_soat <= 24),
  faol            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_amaliyot_turlar_kod ON amaliyot_turlar (lower(kod));

-- 2. Korxonalar ma'lumotnomasi
CREATE TABLE IF NOT EXISTS amaliyot_korxonalar (
  id          BIGSERIAL PRIMARY KEY,
  nomi        VARCHAR(200) NOT NULL,
  manzil      VARCHAR(300),
  stir        VARCHAR(20),
  rahbar_fio  VARCHAR(150),
  telefon     VARCHAR(30),
  faol        BOOLEAN      NOT NULL DEFAULT TRUE,
  yaratgan_id BIGINT       REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_amaliyot_korxonalar_nomi ON amaliyot_korxonalar (lower(nomi));

-- 3. Korxona mentorlari (Google akkaunt orqali ro'yxatdan o'tadi, ustoz tasdiqlaydi va bir martalik muddat belgilaydi)
CREATE TABLE IF NOT EXISTS amaliyot_mentorlar (
  id                       BIGSERIAL PRIMARY KEY,
  korxona_id               BIGINT       REFERENCES amaliyot_korxonalar(id) ON DELETE SET NULL,
  korxona_nomi_kiritilgan  VARCHAR(200),
  ustoz_id                 BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ism                      VARCHAR(100) NOT NULL,
  familiya                 VARCHAR(100) NOT NULL,
  ochestva                 VARCHAR(100),
  lavozim                  VARCHAR(150),
  email                    VARCHAR(150) NOT NULL,
  google_sub               VARCHAR(120),
  telefon                  VARCHAR(30),
  holat                    VARCHAR(20)  NOT NULL DEFAULT 'kutilmoqda'
    CHECK (holat IN ('kutilmoqda', 'tasdiqlandi', 'rad_etildi', 'muzlatilgan')),
  bir_martalik_muddat_kun  INTEGER      CHECK (bir_martalik_muddat_kun IS NULL OR bir_martalik_muddat_kun > 0),
  amal_qilish_gacha        TIMESTAMPTZ,
  tasdiqlagan_id           BIGINT       REFERENCES users(id) ON DELETE SET NULL,
  tasdiqlangan_vaqt        TIMESTAMPTZ,
  muzlatilgan_vaqt         TIMESTAMPTZ,
  rad_sababi               TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_amaliyot_mentorlar_email ON amaliyot_mentorlar (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS ux_amaliyot_mentorlar_google_sub ON amaliyot_mentorlar (google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_amaliyot_mentorlar_ustoz ON amaliyot_mentorlar (ustoz_id, holat);

-- 4. Talaba amaliyot biriktirishlari
CREATE TABLE IF NOT EXISTS amaliyot_biriktirishlar (
  id              BIGSERIAL PRIMARY KEY,
  student_id      BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ustoz_id        BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  korxona_id      BIGINT       NOT NULL REFERENCES amaliyot_korxonalar(id) ON DELETE RESTRICT,
  mentor_id       BIGINT       REFERENCES amaliyot_mentorlar(id) ON DELETE SET NULL,
  tur_id          BIGINT       NOT NULL REFERENCES amaliyot_turlar(id) ON DELETE RESTRICT,
  boshlanish_sana DATE         NOT NULL,
  tugash_sana     DATE         NOT NULL,
  mavzu           VARCHAR(300),
  holat           VARCHAR(20)  NOT NULL DEFAULT 'faol'
    CHECK (holat IN ('faol', 'yakunlangan', 'bekor_qilingan')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (tugash_sana >= boshlanish_sana)
);
CREATE INDEX IF NOT EXISTS ix_amaliyot_biriktirish_student ON amaliyot_biriktirishlar (student_id, holat);
CREATE INDEX IF NOT EXISTS ix_amaliyot_biriktirish_ustoz   ON amaliyot_biriktirishlar (ustoz_id, holat);
CREATE INDEX IF NOT EXISTS ix_amaliyot_biriktirish_mentor  ON amaliyot_biriktirishlar (mentor_id, holat);

-- 5. Har kunlik amaliyot kundaligi yozuvlari
CREATE TABLE IF NOT EXISTS amaliyot_kundalik (
  id                     BIGSERIAL PRIMARY KEY,
  biriktirish_id         BIGINT       NOT NULL REFERENCES amaliyot_biriktirishlar(id) ON DELETE CASCADE,
  sana                   DATE         NOT NULL,
  ish_mazmuni            TEXT         NOT NULL,
  soat                   NUMERIC(4,1) NOT NULL DEFAULT 6.0 CHECK (soat > 0 AND soat <= 24),
  natija                 TEXT,
  ustoz_holat            VARCHAR(20)  NOT NULL DEFAULT 'kutilmoqda'
    CHECK (ustoz_holat IN ('kutilmoqda', 'tasdiqlandi', 'qaytarildi')),
  ustoz_izoh             TEXT,
  ustoz_tasdiqlagan_vaqt TIMESTAMPTZ,
  mentor_holat           VARCHAR(20)  NOT NULL DEFAULT 'kutilmoqda'
    CHECK (mentor_holat IN ('kutilmoqda', 'tasdiqlandi', 'qaytarildi')),
  mentor_fikr            TEXT,
  mentor_tasdiqlagan_vaqt TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_amaliyot_kundalik_sana ON amaliyot_kundalik (biriktirish_id, sana);
CREATE INDEX IF NOT EXISTS ix_amaliyot_kundalik_biriktirish ON amaliyot_kundalik (biriktirish_id, sana);

-- 6. Xulosalar kitobchasi
CREATE TABLE IF NOT EXISTS amaliyot_xulosalar (
  id                          BIGSERIAL PRIMARY KEY,
  biriktirish_id              BIGINT       NOT NULL UNIQUE REFERENCES amaliyot_biriktirishlar(id) ON DELETE CASCADE,
  bolimlar_javobi             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  bajarilgan_ishlar_xulosasi  TEXT,
  ozlashtirilgan_konikmalar   TEXT,
  muammo_va_takliflar         TEXT,
  yakuniy_xulosa              TEXT,
  talaba_holat                VARCHAR(20)  NOT NULL DEFAULT 'qoralama'
    CHECK (talaba_holat IN ('qoralama', 'topshirildi')),
  talaba_topshirdi_vaqt       TIMESTAMPTZ,
  ustoz_holat                 VARCHAR(20)  NOT NULL DEFAULT 'kutilmoqda'
    CHECK (ustoz_holat IN ('kutilmoqda', 'tasdiqlandi', 'qaytarildi')),
  ustoz_izoh                  TEXT,
  ustoz_baho                  SMALLINT     CHECK (ustoz_baho IS NULL OR (ustoz_baho BETWEEN 0 AND 100)),
  ustoz_tasdiqlagan_vaqt      TIMESTAMPTZ,
  mentor_holat                VARCHAR(20)  NOT NULL DEFAULT 'kutilmoqda'
    CHECK (mentor_holat IN ('kutilmoqda', 'tasdiqlandi', 'qaytarildi')),
  mentor_fikr                 TEXT,
  mentor_tasdiqlagan_vaqt     TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_amaliyot_xulosalar_biriktirish ON amaliyot_xulosalar (biriktirish_id);
