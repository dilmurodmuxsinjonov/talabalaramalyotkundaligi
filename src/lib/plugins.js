// Plaginlar yuklovchisi: src/plugins/<nomi>/ papkalarini avtomatik aniqlaydi (_ bilan boshlanganlar o'tkazib yuboriladi)
const fs = require('node:fs');
const path = require('node:path');

const PLUGINS_DIR = path.join(__dirname, '../plugins');

function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();

  const plugins = [];
  for (const dirName of dirs) {
    const dir = path.join(PLUGINS_DIR, dirName);
    const entry = path.join(dir, 'index.js');
    if (!fs.existsSync(entry)) continue;
    const mod = require(entry);
    if (!mod || mod.name !== dirName) {
      throw new Error(`Plagin "${dirName}" index.js da name="${dirName}" bo'lishi shart`);
    }
    const viewsDir = path.join(dir, 'views');
    const publicDir = path.join(dir, 'public');
    const migrationsDir = path.join(dir, 'migrations');
    plugins.push({
      name: mod.name,
      title: mod.title || mod.name,
      router: mod.router || null,
      publicRouter: mod.publicRouter || null,
      nav: Array.isArray(mod.nav) ? mod.nav : [],
      dir,
      viewsDir: fs.existsSync(viewsDir) ? viewsDir : null,
      publicDir: fs.existsSync(publicDir) ? publicDir : null,
      migrationsDir: fs.existsSync(migrationsDir) ? migrationsDir : null,
    });
  }
  return plugins;
}

module.exports = { loadPlugins, PLUGINS_DIR };
