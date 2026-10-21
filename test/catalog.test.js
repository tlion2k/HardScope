// Pruebas del catálogo ampliado (fuentes públicas), del cargador y de la actualización desde GitHub.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const hw = require('../src/analysis/hardware');
const catalog = require('../src/analysis/catalog');
const { analyze } = require('../src/analysis/engine');
const { checkCatalog, isNewerApp } = require('../src/main/catalog-update');

const ROOT = path.join(__dirname, '..');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `hardscope-${name}-`));
const copyBundled = (dir) => {
  for (const f of [...Object.values(catalog.FILES), 'manifest.json']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(catalog.BUNDLED_DIR, f), path.join(dir, f));
  }
};

test('tarjeta fuera del catálogo curado: índice estimado con datos medidos', () => {
  const g = hw.identifyGpu('NVIDIA RTX A4000');
  assert.equal(g.origin, 'estimated');
  assert.equal(g.conf, 'baja');
  assert.ok(g.score > 0 && g.blender.n >= 15);
  const r = analyze({ cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, board: { model: 'B650 AORUS ELITE' }, ram: { modules: [] }, gpus: [{ name: 'NVIDIA RTX A4000', vram: 16376 }], disks: [], volumes: [] });
  const ids = r.findings.map((f) => f.id);
  assert.ok(ids.includes('gpu-estimated') && !ids.includes('gpu-unknown'));
});

test('portátiles: se usa la relación medida portátil/escritorio cuando existe', () => {
  const lap = hw.identifyGpu('NVIDIA GeForce RTX 4090 Laptop GPU');
  assert.equal(lap.laptopRatio.source, 'blender');
  assert.ok(lap.laptopRatio.value < 0.8, 'la 4090 de portátil rinde bastante menos que la de escritorio');
  assert.ok(lap.score < hw.identifyGpu('NVIDIA GeForce RTX 4090').score);
});

test('las tarjetas curadas suman consumo y render medido; los procesadores, render medido', () => {
  const g = hw.identifyGpu('NVIDIA GeForce RTX 4070 SUPER');
  assert.equal(g.origin, 'curated');
  assert.ok(g.tdp > 0 && g.blender.score > 0);
  assert.ok(hw.identifyCpu('Intel(R) Core(TM) i5-14600KF').blender.score > 0);
});

test('el cargador usa un catálogo descargado más nuevo y vuelve al incluido si está dañado', () => {
  const dir = tmp('cat');
  copyBundled(dir);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const run = () => execFileSync(process.execPath, ['-e', "process.stdout.write(require('./src/analysis/catalog').origin)"], { cwd: ROOT, env: { ...process.env, HARDSCOPE_CATALOG_DIR: dir } }).toString();
  assert.equal(run(), 'bundled', 'misma versión: se usa el incluido');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, version: m.version + 1 }));
  assert.equal(run(), 'downloaded');
  fs.writeFileSync(path.join(dir, 'gpus.json'), '{ dañado');
  assert.equal(run(), 'bundled');
});

// GitHub simulado: sirve los archivos del catálogo incluido con un manifiesto modificable.
function fakeGithub(manifest, overrides = {}) {
  return async (url) => {
    const file = url.split('/src/data/')[1];
    const body = file === 'manifest.json' ? Buffer.from(JSON.stringify(manifest)) : overrides[file] || fs.readFileSync(path.join(catalog.BUNDLED_DIR, file));
    return { ok: true, status: 200, json: async () => JSON.parse(body), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
}

test('actualización del catálogo: descarga, verifica y guarda una versión nueva', async () => {
  const current = catalog.readManifest(catalog.BUNDLED_DIR);
  const target = path.join(tmp('upd'), 'catalog');
  const res = await checkCatalog({ repo: 'x/y', current, targetDir: target, appVersion: '9.9.9', fetchImpl: fakeGithub({ ...current, version: current.version + 1 }) });
  assert.equal(res.status, 'updated');
  assert.ok(fs.existsSync(path.join(target, 'generated', 'gpus-extra.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8')).version, current.version + 1);
});

test('actualización del catálogo: rechaza archivos alterados y conserva el actual', async () => {
  const current = catalog.readManifest(catalog.BUNDLED_DIR);
  const target = path.join(tmp('bad'), 'catalog');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'marca.txt'), 'actual');
  const res = await checkCatalog({ repo: 'x/y', current, targetDir: target, appVersion: '9.9.9', fetchImpl: fakeGithub({ ...current, version: current.version + 1 }, { 'gpus.json': Buffer.from('{"gpus":[]}') }) });
  assert.equal(res.status, 'error');
  assert.match(res.message, /huella/);
  assert.equal(fs.readFileSync(path.join(target, 'marca.txt'), 'utf8'), 'actual');
});

test('actualización del catálogo: al día, formato incompatible o app antigua', async () => {
  const current = catalog.readManifest(catalog.BUNDLED_DIR);
  const target = path.join(tmp('st'), 'catalog');
  const call = (manifest, appVersion = '9.9.9') => checkCatalog({ repo: 'x/y', current, targetDir: target, appVersion, fetchImpl: fakeGithub(manifest) });
  assert.equal((await call(current)).status, 'up-to-date');
  assert.equal((await call({ ...current, version: current.version + 1, schema: 99 })).status, 'incompatible');
  assert.equal((await call({ ...current, version: current.version + 1, minApp: '99.0.0' }, '1.7.0')).status, 'needs-app');
  assert.ok(isNewerApp('1.10.0', '1.9.9') && !isNewerApp('1.7.0', '1.7.0'));
});

test('importador: procesa resultados de Blender y especificaciones en un catálogo liviano', () => {
  const dir = tmp('imp');
  const rec = (name, type, scene, spm) => JSON.stringify({ created_at: '2026-10-01T00:00:00Z', schema_version: 'v4', data: { blender_version: { version: '4.5.0' }, device_info: { device_type: type, compute_devices: [{ name, type }] }, scene: { label: scene }, stats: { samples_per_minute: spm } } });
  const lines = [];
  for (const [name, type, base] of [['NVIDIA GeForce RTX 4070 SUPER', 'OPTIX', 2000], ['NVIDIA GeForce RTX 4060', 'OPTIX', 1000], ['NVIDIA GeForce RTX 4080', 'OPTIX', 2800], ['NVIDIA RTX 4000 Ada Generation', 'OPTIX', 1500], ['AMD Ryzen 7 7700X 8-Core Processor', 'CPU', 100]]) {
    for (const scene of ['monster', 'junkshop', 'classroom']) for (let i = 0; i < 6; i++) lines.push(rec(name, type, scene, base + i));
  }
  lines.push(rec('NVIDIA GeForce RTX 4060', 'OPTIX', 'monster', 1e9).replace('"compute_devices":[', '"compute_devices":[{"name":"Otra GPU","type":"OPTIX"},')); // varias GPU: se ignora
  const spec = { catalog_version: 'test', gpus: [{ name: 'RTX 4000 Ada Generation', vendor: 'nvidia', device_type: 'discrete', generation: 'Quadro Ada', release_date: '2023-03-21', memory: { capacity_gb: 20 }, specs: { bus_interface: 'PCIe 4.0 x16', tdp_w: 130 } }, { name: 'Instinct MI300X', vendor: 'amd', device_type: 'discrete', memory: { capacity_gb: 192 } }] };
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'import-external.js'), '--open-gpu-db', path.join(dir, 'spec.json'), '--out', dir], { input: lines.join('\n'), cwd: ROOT });
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'gpus-extra.json'), 'utf8'));
  const cpus = JSON.parse(fs.readFileSync(path.join(dir, 'cpus-blender.json'), 'utf8'));
  const ada = out.gpus.find((g) => g.key === 'rtx 4000 ada generation');
  assert.equal(out.meta.sources.blender.license, 'CC0 1.0');
  assert.ok(ada && ada.blender > 0 && ada.vram === 20 && ada.pcie === 4 && ada.tdp === 130 && ada.est > 0);
  assert.ok(!out.gpus.some((g) => /mi300x/.test(g.key)), 'los aceleradores de centro de datos se excluyen');
  assert.ok(out.gpus.find((g) => g.key === 'rtx 4060').blender < 5000, 'los resultados con varias GPU se ignoran');
  assert.ok(cpus.cpus.some((c) => c.key === 'ryzen 7 7700x'));
});
