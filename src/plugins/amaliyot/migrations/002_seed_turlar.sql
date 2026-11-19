-- Standart amaliyot kundaligi turlari
INSERT INTO amaliyot_turlar (kod, nomi, tavsif, kunlik_min_soat, bolimlar_json) VALUES
  (
    'oquv_tanishuv',
    'O''quv-tanishuv amaliyoti',
    'Quyi kurs talabalari uchun korxona tuzilmasi va ish jarayonlari bilan tanishish amaliyoti',
    4.0,
    '[
      {"key":"maqsad","title":"Amaliyot maqsadi va vazifalari","hint":"Korxona bilan tanishuv rejasi"},
      {"key":"xavfsizlik","title":"Mehnat muhofazasi va texnika xavfsizligi yo''riqnomasi","hint":"Korxonada o''tilgan kirish yo''riqnomasi sanasi va mazmuni"},
      {"key":"tuzilma","title":"Korxona bo''limlari va faoliyat yo''nalishi","hint":"Asosiy bo''limlar va ularning vazifalari"}
    ]'::jsonb
  ),
  (
    'ishlab_chiqarish',
    'Ishlab chiqarish amaliyoti',
    'Mutaxassislik bo''yicha real ishlab chiqarish va dasturiy/texnik jarayonlarda qatnashish amaliyoti',
    6.0,
    '[
      {"key":"individual_reja","title":"Individual amaliyot topshirig''i va ish rejasi","hint":"Ustoz va mentor bilan kelishilgan asosiy vazifalar"},
      {"key":"xavfsizlik","title":"Texnika va axborot xavfsizligi yo''riqnomasi","hint":"O''tilgan yo''riqnoma va ruxsatnoma ma''lumotlari"},
      {"key":"texnologiya","title":"Qo''llanilgan texnologiyalar va vositalar","hint":"Korxonada ishlatilgan dasturiy/uskunaviy vositalar"}
    ]'::jsonb
  ),
  (
    'malakaviy',
    'Malakaviy amaliyot',
    'Kasbiy kompetensiyalarni chuqurlashtirish va mustaqil loyiha vazifalarini bajarish amaliyoti',
    6.0,
    '[
      {"key":"loyiha_vazifa","title":"Malakaviy loyiha topshirig''i","hint":"Korxona tomonidan berilgan amaliy loyiha tavsifi"},
      {"key":"metodologiya","title":"Ish uslubi va standartlar","hint":"Foydalanilgan standart, metodika va hujjatlar"},
      {"key":"natija_tahlil","title":"Amaliy yechim va iqtisodiy/texnik samara","hint":"Olingan natijalar tahlili"}
    ]'::jsonb
  ),
  (
    'diplomoldi',
    'Diplomoldi amaliyoti',
    'Bitiruv malakaviy ishi uchun ma''lumot yig''ish, tahlil qilish va tajriba-sinov o''tkazish amaliyoti',
    6.0,
    '[
      {"key":"bmi_mavzu","title":"Bitiruv malakaviy ishi mavzusi va ob''ekti","hint":"BMI bilan bog''liq korxona bo''limi va tadqiqot ob''ekti"},
      {"key":"empirik_baza","title":"Yig''ilgan ma''lumotlar va tajriba bazasi","hint":"Tadqiqot uchun olingan real ma''lumotlar va materiallar"},
      {"key":"tatbiq","title":"Ishlanmani amaliyotga tatbiq etish natijalari","hint":"Korxonada sinovdan o''tkazish xulosasi"}
    ]'::jsonb
  )
ON CONFLICT (lower(kod)) DO NOTHING;
