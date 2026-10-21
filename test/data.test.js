// Pruebas del validador de catálogos: el catálogo real pasa y los errores típicos se detectan.
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../src/analysis/validate-data');
const gpuData = require('../src/data/gpus.json');
const platformData = require('../src/data/platforms.json');

const clone = (x) => JSON.parse(JSON.stringify(x));

test('el catálogo publicado no tiene errores', () => {
  const { errors } = validate();
  assert.deepEqual(errors, []);
});

test('detecta GPUs con datos inválidos', () => {
  const g = clone(gpuData);
  g.gpus.push({ ...g.gpus[0] }); // id duplicado
  g.gpus.push({ id: 'rtx 9999', name: 'GeForce RTX 9999', score: 50, pcie: 7, lanes: 12, vram: 8, year: 2026 });
  g.gpus.push({ id: 'Rx 1', name: 'Radeon RX 1', score: -1, pcie: 4, lanes: 16, vram: 8, year: 1999 });
  g.gpus.push({ id: 'rtx 1234', name: 'GeForce GTX 4321', score: 10, pcie: 4, lanes: 8, vram: 8, year: 2024 });
  const { errors } = validate({ gpuData: g });
  const text = errors.join('\n');
  assert.match(text, /duplicado/);
  assert.match(text, /"pcie"/);
  assert.match(text, /"lanes"/);
  assert.match(text, /minúsculas/);
  assert.match(text, /"score"/);
  assert.match(text, /"year"/);
  assert.match(text, /se identifica como/);
});

test('detecta chipsets que apuntan a plataformas inexistentes y CPUs no reconocidas', () => {
  const p = clone(platformData);
  p.chipsets.Q999 = { platform: 'LGA9999', segment: 'pro', gpuPcie: 9 };
  p.platforms.AM5.bestCpus.push('Procesador Inventado 3000');
  const text = validate({ platformData: p }).errors.join('\n');
  assert.match(text, /«LGA9999» no existe/);
  assert.match(text, /"segment"/);
  assert.match(text, /"gpuPcie"/);
  assert.match(text, /no se reconoce/);
});

test('avisa cuando el catálogo lleva más de un año sin revisarse', () => {
  const later = new Date(new Date(gpuData.meta.updated).getTime() + 400 * 864e5);
  const { warnings } = validate({ now: later });
  assert.ok(warnings.some((w) => /no se revisa hace/.test(w)));
});
