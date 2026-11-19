# Amaliyot kundaligi (`amaliyot`) plagini

Talabalarning ishlab chiqarish, o'quv-tanishuv, malakaviy va diplomoldi amaliyotlarini to'liq formatlashtirish va raqamlashtirish uchun mustaqil plagin.

## Rollar va imkoniyatlar

- **Talaba (`student`):**
  - Har kunlik bajarilgan ishlar (sana, mazmun, soat, natija) bo'yicha kundalik yozuvlarini kiritish va tahrirlash.
  - Standart to'ldiriladigan **Word (`.docx`)** ko'rinishidagi amaliyot kundaligini yuklab olish.
  - Amaliyot turi bo'yicha standart bo'limlar va **Xulosalar kitobchasi**ni to'ldirish hamda `.docx` formatida yuklab olish.
- **Biriktirilgan ustoz (`teacher`, nazorat uchun `dekanat`, `admin`):**
  - Korxonalar qo'shish va talabani korxona/mentorga biriktirish.
  - **Kundalik turini o'zgartirish** (amaliyot biriktirilgandan keyin ham).
  - Kunlik yozuvlarni va xulosalar kitobchasini tasdiqlash, baholash yoki izoh bilan qaytarish.
  - Korxona mentorining ro'yxatdan o'tish arizasini (`bildirishnomalar` xabarnomasi orqali) ko'rish, **tasdiqlash** hamda **bir martalik amal qilish (muzlatish) muddatini** belgilash.
- **Korxona mentori (`mentor`):**
  - Google akkaunt (`GOOGLE_CLIENT_ID` sozlanganda haqiqiy Google OAuth 2.0, aks holda Google email formasi) orqali ro'yxatdan o'tish.
  - Ustoz tasdiqlamaguncha tizimga kira olmaslik; ustoz belgilagan bir martalik muddat tugagach akkauntning **avtomatik muzlatilishi**.
  - Biriktirilgan talabalarning kundalik yozuvlarini va xulosalar kitobchasini tasdiqlash hamda ixtiyoriy qo'shimcha fikr qo'shish.

## Marshrutlar

| Usul | URL | Rol | Vazifasi |
|---|---|---|---|
| `GET` | `/amaliyot` | `student` | Talaba kundaligi bosh sahifasi |
| `POST` | `/amaliyot/kundalik` | `student` | Kunlik yozuv qo'shish / tahrirlash |
| `GET/POST` | `/amaliyot/xulosa` | `student` | Xulosalar kitobchasini to'ldirish / topshirish |
| `GET` | `/amaliyot/:id/docx` | `student`, `teacher`, `dekanat`, `admin` | Standart kundalikni `.docx` formatida yuklab olish |
| `GET` | `/amaliyot/:id/xulosa-docx` | `student`, `teacher`, `dekanat`, `admin` | Xulosalar kitobchasini `.docx` formatida yuklab olish |
| `GET` | `/amaliyot/ustoz` | `teacher`, `dekanat`, `admin` | Ustoz nazorat paneli va mentorlarni tasdiqlash |
| `GET` | `/amaliyot/ustoz/talaba/:id` | `teacher`, `dekanat`, `admin` | Talaba kundaligi va xulosasini tekshirish |
| `POST` | `/amaliyot/korxona` | `teacher`, `dekanat`, `admin` | Yangi korxona qo'shish |
| `POST` | `/amaliyot/biriktirish` | `teacher`, `dekanat`, `admin` | Talabani amaliyotga biriktirish |
| `POST` | `/amaliyot/biriktirish/:id/tur` | `teacher`, `dekanat`, `admin` | Kundalik turini o'zgartirish |
| `POST` | `/amaliyot/biriktirish/:id/mentor` | `teacher`, `dekanat`, `admin` | Biriktirilgan mentorni yangilash |
| `POST` | `/amaliyot/kundalik/:id/ustoz-holat` | `teacher`, `dekanat`, `admin` | Kunlik yozuvni tasdiqlash / qaytarish |
| `POST` | `/amaliyot/xulosa/:id/ustoz-holat` | `teacher`, `dekanat`, `admin` | Xulosalar kitobchasini tasdiqlash / baholash |
| `POST` | `/amaliyot/mentor/:id/tasdiqlash` | `teacher`, `dekanat`, `admin` | Mentorni tasdiqlash va bir martalik muddat belgilash |
| `GET/POST` | `/admin/amaliyot/turlar` | `teacher`, `dekanat`, `admin` | Kundalik turlari va bo'limlarini boshqarish |
| `GET/POST` | `/amaliyot/mentor/royxat` | Ochiq | Mentor Google ro'yxatdan o'tishi |
| `GET/POST` | `/amaliyot/mentor/kirish` | Ochiq | Mentor kirishi |
| `GET` | `/amaliyot/mentor/google` | Ochiq | Google OAuth 2.0 boshlash |
| `GET` | `/amaliyot/mentor/google/callback` | Ochiq | Google OAuth 2.0 callback |
| `GET` | `/amaliyot/mentor` | `mentor` (faol) | Mentor paneli |
| `POST` | `/amaliyot/mentor/kundalik/:id/holat` | `mentor` (faol) | Kundalikni tasdiqlash + ixtiyoriy fikr |
| `POST` | `/amaliyot/mentor/xulosa/:id/holat` | `mentor` (faol) | Xulosani tasdiqlash + ixtiyoriy fikr |

## Yaratilgan jadvallar

- `amaliyot_turlar` — kundalik turlari va ularning standart bo'limlari (`bolimlar_json`)
- `amaliyot_korxonalar` — amaliyot korxonalari ma'lumotnomasi
- `amaliyot_mentorlar` — korxona mentorlari, tasdiqlash holati va bir martalik muzlatish muddati (`amal_qilish_gacha`)
- `amaliyot_biriktirishlar` — talaba, ustoz, korxona, mentor va kundalik turi bog'lanishi
- `amaliyot_kundalik` — har kunlik ishlar, ustoz va mentor tasdig'i, mentor fikri
- `amaliyot_xulosalar` — talabaning xulosalar kitobchasi, ustoz bahosi va mentor fikri

## Sozlash

Haqiqiy Google OAuth 2.0 orqali mentor kirishini yoqish uchun `.env` fayliga quyidagilarni qo'shing (ixtiyoriy — bo'lmasa Google email orqali lokal ro'yxatdan o'tish ishlaydi):

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

`.docx` hujjatlar tashqi npm paket qo'shilmasdan Node.js ichki `node:zlib` moduli (`lib/docx.js`) orqali yaratiladi.

## Asosiy kodga takliflar

Plagin mustaqil ishlashi uchun asosiy `users` jadvalining `role` cheklovi o'zgartirilmadi; tashqi mentorlar `amaliyot_mentorlar` jadvalida va alohida `req.session.mentorId` sessiyasi orqali boshqariladi. Agar asosiy tizim plagin yuklovchisiga ega bo'lsa:
1. `src/app.js` da plaginlardan `publicRouter` ixtiyoriy eksportini `requireLogin` dan oldin ulash tavsiya etiladi (tashqi mentorlarning `/amaliyot/mentor/kirish`, `/amaliyot/mentor/royxat`, `/amaliyot/mentor/google*` sahifalari ochiq bo'lishi uchun).
2. `src/views/login.hbs` sahifasida korxona mentorlari uchun `/amaliyot/mentor/kirish` havolasini ko'rsatish foydalanuvchi oqimini qulaylashtiradi.
3. Agar kelajakda mentorlarni ham umumiy `users` jadvaliga kiritish rejalashtirilsa, `users_role_check` chekloviga `'mentor'` rolini qo'shish kifoya qiladi.
