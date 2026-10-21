// Pruebas sobre inventarios completos (test/fixtures): uno real anonimizado y varios sintéticos.
// Cada inventario se analiza en todas las combinaciones de uso y resolución, con y sin perfil,
// y se comparan los hechos conocidos de su bloque "expect".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyze } = require('../src/analysis/engine');

const dir = path.join(__dirname, 'fixtures');
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
const SEVERITIES = ['critical', 'warning', 'tip', 'ok'];
const COMPONENTS = ['cpu', 'board', 'gpu', 'ram', 'storage', 'system'];
const PREFS = { name: 'Prueba', cpuBrand: 'AMD', gpuBrand: 'NVIDIA', boardBrand: 'MSI', psuBrand: 'Corsair', ramBrand: 'Kingston', storageBrand: 'Samsung', budget: 'equilibrado' };

test('hay al menos un inventario real y todos declaran su origen', () => {
  assert.ok(fixtures.some((f) => f.origin === 'real'));
  for (const f of fixtures) assert.ok(['real', 'synthetic'].includes(f.origin), `${f.file}: origin inválido`);
});

test('los inventarios no contienen el nombre del equipo', () => {
  for (const f of fixtures) assert.equal(f.profile.os?.hostname ?? null, null, `${f.file}: tiene hostname`);
});

for (const fx of fixtures) {
  test(`${fx.file} (${fx.origin}): análisis estable en todas las combinaciones`, () => {
    for (const usage of ['gaming', 'creation', 'office']) {
      for (const resolution of ['1080p', '1440p', '4k']) {
        for (const prefs of [null, PREFS]) {
          const r = analyze(fx.profile, { usage, resolution, prefs });
          assert.ok(Number.isInteger(r.health) && r.health >= 5 && r.health <= 100, 'índice fuera de rango');
          for (const f of r.findings) {
            assert.ok(SEVERITIES.includes(f.severity), `${f.id}: severidad`);
            assert.ok(COMPONENTS.includes(f.component), `${f.id}: componente`);
            assert.ok(f.title && f.plain?.title, `${f.id}: textos`);
            assert.ok(!f.checks || f.checks.every((c) => typeof c === 'string' && c.length > 10), `${f.id}: verificaciones`);
          }
          for (const s of r.upgrades.steps) {
            assert.ok(Number.isFinite(s.gainPct) && s.gainPct >= 5 || r.upgrades.steps.indexOf(s) < r.upgrades.steps.length - 1, 'paso final sin ganancia');
            assert.ok(Array.isArray(s.checks) && s.checks.length, 'paso sin verificaciones');
            assert.ok(s.after.gpu <= Math.max(s.before.gpu, s.after.cpu * 1.08 + 0.5), 'la GPU sugerida supera al procesador');
          }
          if (prefs) assert.equal(r.profileMatch.rows.length, 6);
          else assert.equal(r.profileMatch, null);
        }
      }
    }
  });

  test(`${fx.file} (${fx.origin}): hechos conocidos`, () => {
    const r = analyze(fx.profile);
    const e = fx.expect || {};
    const ids = new Set(r.findings.map((f) => f.id));
    if ('chipset' in e) assert.equal(r.components.board.chipset?.id ?? null, e.chipset);
    if (e.gpuId) assert.equal(r.components.gpu?.match?.id, e.gpuId);
    if (e.gpuMaker) assert.equal(r.components.gpu?.maker, e.gpuMaker);
    if ('laptop' in e) assert.equal(r.laptop, e.laptop);
    if ('cpuEstimated' in e) assert.equal(r.components.cpu.estimated, e.cpuEstimated);
    if (e.channel) assert.equal(r.components.ram.channel, e.channel);
    if (e.ratedSpeed) assert.equal(r.components.ram.ratedSpeed, e.ratedSpeed);
    if (e.boardVerdict) assert.equal(r.balance.boardVsGpu.verdict, e.boardVerdict);
    if ('maxSteps' in e) assert.ok(r.upgrades.steps.length <= e.maxSteps);
    if ('maxCritical' in e) assert.ok(r.counts.critical <= e.maxCritical);
    if ('dataIssues' in e) assert.equal(r.dataIssues.length, e.dataIssues);
    for (const id of e.findings || []) assert.ok(ids.has(id), `falta el hallazgo ${id}`);
    for (const id of e.noFindings || []) assert.ok(!ids.has(id), `no debería aparecer ${id}`);
    for (const [id, sev] of Object.entries(e.severities || {})) assert.equal(r.findings.find((f) => f.id === id)?.severity, sev, id);
  });
}
