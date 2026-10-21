// Descarga el catálogo más reciente publicado en GitHub (src/data del repositorio) y lo guarda
// en la carpeta de datos de la app. Sólo se acepta si cada archivo coincide con su huella
// SHA-256 del manifiesto y si el conjunto pasa el validador; si algo falla se conserva el actual.
// Se aplica al reiniciar la app (src/analysis/catalog.js elige la copia más nueva).
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const catalog = require('../analysis/catalog');
const { validate } = require('../analysis/validate-data');

const rawBase = (repo) => `https://raw.githubusercontent.com/${repo}/main/src/data/`;

function isNewerApp(required, current) {
  const a = String(required).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

async function get(fetchImpl, url, type) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'HardScope' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return type === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
}

// current: el manifiesto del catálogo en uso. targetDir: carpeta donde guardar la descarga.
async function checkCatalog({ repo, current, targetDir, appVersion, fetchImpl = fetch }) {
  if (!repo) return { status: 'error', message: 'Repositorio no configurado' };
  const base = rawBase(repo);
  const remote = await get(fetchImpl, `${base}manifest.json`, 'json');
  if (remote.schema !== current?.schema) return { status: 'incompatible', message: 'El catálogo publicado usa un formato nuevo: actualiza HardScope.' };
  if (remote.minApp && isNewerApp(remote.minApp, appVersion)) return { status: 'needs-app', message: `El catálogo nuevo requiere HardScope ${remote.minApp} o superior.` };
  if (!(remote.version > (current?.version ?? 0))) return { status: 'up-to-date', version: current?.version };

  const tmp = `${targetDir}.tmp`;
  await fs.rm(tmp, { recursive: true, force: true });
  try {
    for (const file of Object.values(catalog.FILES)) {
      const expected = remote.files?.[file];
      if (!expected) throw new Error(`El manifiesto no incluye ${file}`);
      const buf = await get(fetchImpl, base + file, 'buffer');
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      if (sha !== expected.sha256) throw new Error(`La huella de ${file} no coincide`);
      await fs.mkdir(path.dirname(path.join(tmp, file)), { recursive: true });
      await fs.writeFile(path.join(tmp, file), buf);
    }
    await fs.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(remote, null, 2));
    const d = catalog.readSet(tmp);
    const { errors } = validate({ gpuData: d.gpus, platformData: d.platforms, brands: d.brands, gpusExtra: d.gpusExtra, cpusBlender: d.cpusBlender });
    if (errors.length) throw new Error(`El catálogo descargado no pasó la validación (${errors.length} error(es))`);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rename(tmp, targetDir);
    return { status: 'updated', version: remote.version };
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    return { status: 'error', message: err.message };
  }
}

module.exports = { checkCatalog, isNewerApp };
