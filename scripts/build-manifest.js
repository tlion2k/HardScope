// Genera src/data/manifest.json: versión del catálogo y huella SHA-256 de cada archivo.
// La app la usa para saber si hay un catálogo más nuevo y verificar lo que descarga.
// La versión sólo cambia cuando cambia algún archivo.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FILES, BUNDLED_DIR, readManifest } = require('../src/analysis/catalog');

const pkg = require('../package.json');
const previous = readManifest(BUNDLED_DIR);
const files = {};
for (const file of Object.values(FILES)) {
  const buf = fs.readFileSync(path.join(BUNDLED_DIR, file));
  files[file] = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
const changed = !previous || JSON.stringify(previous.files) !== JSON.stringify(files);
const now = new Date();
const stamp = +now.toISOString().replace(/\D/g, '').slice(0, 12); // AAAAMMDDhhmm
const manifest = {
  schema: 1,
  version: changed ? stamp : previous.version,
  generated: changed ? now.toISOString() : previous.generated,
  minApp: previous?.minApp || pkg.version,
  files,
};
fs.writeFileSync(path.join(BUNDLED_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(changed ? `Catálogo versión ${manifest.version}` : `Sin cambios (versión ${manifest.version})`);
