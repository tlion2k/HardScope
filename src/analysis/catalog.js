// Carga los catálogos de datos. Usa la copia incluida en la app o, si existe una versión
// más nueva descargada y verificada (ver src/main/catalog-update.js), esa copia.
// El directorio de descargas lo fija el proceso principal en HARDSCOPE_CATALOG_DIR.
const fs = require('fs');
const path = require('path');

const BUNDLED_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  gpus: 'gpus.json',
  platforms: 'platforms.json',
  brands: 'brands.json',
  gpusExtra: 'generated/gpus-extra.json',
  cpusBlender: 'generated/cpus-blender.json',
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function readManifest(dir) {
  try {
    return readJson(path.join(dir, 'manifest.json'));
  } catch {
    return null;
  }
}

// Los catálogos generados son opcionales: sin ellos la app funciona sólo con el catálogo curado.
const OPTIONAL = { gpusExtra: { meta: {}, gpus: [] }, cpusBlender: { meta: {}, cpus: [] } };

function readSet(dir) {
  const out = {};
  for (const [key, file] of Object.entries(FILES)) {
    const full = path.join(dir, file);
    out[key] = key in OPTIONAL && !fs.existsSync(full) ? OPTIONAL[key] : readJson(full);
  }
  return out;
}

function load() {
  const bundled = readManifest(BUNDLED_DIR);
  const dir = process.env.HARDSCOPE_CATALOG_DIR;
  if (dir) {
    const m = readManifest(dir);
    if (m && bundled && m.schema === bundled.schema && m.version > bundled.version) {
      try {
        return { ...readSet(dir), manifest: m, origin: 'downloaded', dir };
      } catch {
        // copia descargada dañada: se usa la incluida
      }
    }
  }
  return { ...readSet(BUNDLED_DIR), manifest: bundled, origin: 'bundled', dir: BUNDLED_DIR };
}

module.exports = { ...load(), FILES, BUNDLED_DIR, readSet, readManifest };
