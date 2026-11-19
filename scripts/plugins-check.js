// Plaginlarning nomlash va xavfsizlik qoidalarini tekshirish (npm run plugins:check)
const fs = require('node:fs');
const path = require('node:path');

const PLUGINS_DIR = path.join(__dirname, '../src/plugins');
const CORE_TABLES = [
  'users', 'student_info', 'teacher_info', 'dekanat_user_info', 'guruhlar', 'bolimlar',
  'xodim_bolim', 'tyutor_guruh', 'murojaat_turlari', 'qabul_vaqti', 'qabul_istisno',
  'bayramlar', 'navbatlar', 'navbat_tarix', 'audit_log', 'sozlamalar', 'bildirishnomalar',
  'tg_link_tokens', 'session', 'schema_migrations',
];

function walk(dir, extList) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full, extList));
    else if (extList.some((e) => item.name.endsWith(e))) out.push(full);
  }
  return out;
}

function checkPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log('✓ Plaginlar papkasi bo\'sh');
    return;
  }
  const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name);

  const errors = [];
  for (const name of dirs) {
    if (!/^[a-z0-9_]+$/.test(name)) {
      errors.push(`[${name}] papka nomi faqat kichik lotin harflari, raqam va _ bo'lishi kerak`);
    }
    const pDir = path.join(PLUGINS_DIR, name);

    // 1. Migratsiyalar tekshiruvi
    for (const f of walk(path.join(pDir, 'migrations'), ['.sql'])) {
      const sql = fs.readFileSync(f, 'utf8');
      const rel = path.relative(PLUGINS_DIR, f);
      for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi)) {
        if (!m[1].startsWith(`${name}_`)) {
          errors.push(`${rel}: jadval "${m[1]}" ${name}_ bilan boshlanishi shart`);
        }
      }
      for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi)) {
        if (!m[1].startsWith(`ix_${name}_`) && !m[1].startsWith(`ux_${name}_`)) {
          errors.push(`${rel}: indeks "${m[1]}" ix_${name}_ yoki ux_${name}_ bilan boshlanishi shart`);
        }
      }
      for (const ct of CORE_TABLES) {
        const rx = new RegExp(`(?:ALTER|DROP|TRUNCATE)\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${ct}\\b|(?:UPDATE|DELETE\\s+FROM)\\s+${ct}\\b`, 'i');
        if (rx.test(sql)) {
          errors.push(`${rel}: asosiy jadval "${ct}" ga o'zgartirish kiritish taqiqlangan`);
        }
      }
    }

    // 2. Shablonlar tekshiruvi (CSP + XSS)
    for (const f of walk(path.join(pDir, 'views'), ['.hbs'])) {
      const txt = fs.readFileSync(f, 'utf8');
      const rel = path.relative(PLUGINS_DIR, f);
      if (txt.includes('{{{')) errors.push(`${rel}: {{{ }}} ishlatish taqiqlangan`);
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(txt)) errors.push(`${rel}: inline <script> taqiqlangan (CSP)`);
      if (/\son[a-z]+\s*=/i.test(txt)) errors.push(`${rel}: inline event handler (onclick= va h.k.) taqiqlangan`);
      if (/\sstyle\s*=/i.test(txt)) errors.push(`${rel}: inline style="" taqiqlangan (CSP)`);
    }

    // 3. JS fayllar tekshiruvi
    for (const f of walk(pDir, ['.js'])) {
      const txt = fs.readFileSync(f, 'utf8');
      const rel = path.relative(PLUGINS_DIR, f);
      if (txt.includes('toISOString().slice(0, 10)') || txt.includes('toISOString().slice(0,10)')) {
        errors.push(`${rel}: new Date().toISOString().slice(0,10) o'rniga today() ishlating`);
      }
    }
  }

  if (errors.length) {
    console.error('Plagin tekshiruvida xatolar:');
    for (const e of errors) console.error('  ✗ ' + e);
    process.exit(1);
  }
  console.log(`✓ Barcha plaginlar tekshiruvdan o'tdi (${dirs.length} ta)`);
}

checkPlugins();
