const test = require('node:test');
const assert = require('node:assert');
const { analyze, liveBottleneck } = require('../src/analysis/engine');
const hw = require('../src/analysis/hardware');

const GB = 1024 ** 3;
const profile = (over = {}) => ({
  cpu: { brand: 'AMD Ryzen 5 5600X 6-Core Processor', cores: 12, physicalCores: 6, speed: 3.7 },
  board: { manufacturer: 'ASUS', model: 'TUF GAMING B550-PLUS' },
  bios: { version: '1', releaseDate: new Date().toISOString().slice(0, 10) },
  ram: { total: 16 * GB, available: 10 * GB, slots: 4, modules: [{ size: 8 * GB, type: 'DDR4', configuredSpeed: 3200, partNum: 'F4-3200C16-8GVKB' }, { size: 8 * GB, type: 'DDR4', configuredSpeed: 3200, partNum: 'F4-3200C16-8GVKB' }] },
  gpus: [{ name: 'NVIDIA GeForce RTX 4070 SUPER', vram: 12288, pcie: { curGen: 4, curWidth: 16, maxGen: 4, maxWidth: 16 } }],
  disks: [{ name: 'Samsung 980', type: 'SSD', bus: 'NVMe', isSystem: true }],
  volumes: [{ mount: 'C:', size: 1000, used: 400 }],
  ...over,
});
const ids = (r) => Object.fromEntries(r.findings.map((f) => [f.id, f.severity]));

test('identifica GPUs eligiendo el nombre mÃ¡s especÃ­fico', () => {
  assert.equal(hw.identifyGpu('NVIDIA GeForce RTX 4070 SUPER').id, 'rtx 4070 super');
  assert.equal(hw.identifyGpu('AMD Radeon RX 6600 XT').id, 'rx 6600 xt');
  assert.equal(hw.identifyGpu('Intel(R) UHD Graphics 770').integrated, true);
  assert.equal(hw.identifyGpu('NVIDIA GeForce RTX 4060 Laptop GPU').laptop, true);
});

test('identifica chipsets dentro del nombre de la placa', () => {
  assert.equal(hw.identifyChipset('PRIME A320M-K').id, 'A320');
  assert.equal(hw.identifyChipset('ROG STRIX X670E-E GAMING WIFI').id, 'X670E');
  assert.equal(hw.identifyChipset('B650M AORUS ELITE AX').id, 'B650');
  assert.equal(hw.identifyChipset('Z790 PG Lightning').id, 'Z790');
  assert.equal(hw.identifyChipset('0XYZ12'), null);
});

test('lee la velocidad nominal desde el nÃºmero de parte', () => {
  assert.equal(hw.ratedSpeedFromPart('AX5U5200C3816G-BLARB'), 5200);
  assert.equal(hw.ratedSpeedFromPart('KF432C16BB/8'), 3200);
  assert.equal(hw.ratedSpeedFromPart('CMK16GX4M2B3200C16'), 3200);
});

test('equipo equilibrado no genera alertas crÃ­ticas', () => {
  const r = analyze(profile());
  assert.equal(r.counts.critical, 0);
  assert.equal(r.balance.boardVsGpu.verdict, 'balanced');
});

test('placa vieja con GPU de gama alta: la placa no aprovecha la tarjeta', () => {
  const r = analyze(profile({ board: { model: 'PRIME A320M-K' }, cpu: { brand: 'AMD Ryzen 5 1600', cores: 12, physicalCores: 6 }, gpus: [{ name: 'NVIDIA GeForce RTX 4090', vram: 24576 }] }));
  assert.equal(r.balance.boardVsGpu.verdict, 'gpu');
  assert.equal(ids(r)['board-limits-gpu'], 'critical');
  assert.equal(ids(r)['cpu-bottleneck'], 'critical');
});

test('placa moderna con GPU dÃ©bil: la placa es superior', () => {
  const r = analyze(profile({ board: { model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'NVIDIA GeForce GTX 1650', vram: 4096 }] }));
  assert.equal(r.balance.boardVsGpu.verdict, 'board');
  assert.equal(ids(r)['board-superior'], 'warning');
  assert.match(r.findings.find((f) => f.id === 'board-superior').action, /RTX|RX|Arc/);
});

test('RX 6500 XT (x4) en placa PCIe 3.0 es crÃ­tico', () => {
  const r = analyze(profile({ board: { model: 'B450 TOMAHAWK MAX' }, gpus: [{ name: 'AMD Radeon RX 6500 XT', vram: 4096 }] }));
  assert.equal(ids(r)['pcie-gen'], 'critical');
});

test('GPU corriendo con menos carriles de los que tiene', () => {
  const r = analyze(profile({ gpus: [{ name: 'NVIDIA GeForce RTX 3060', vram: 12288, pcie: { curGen: 4, curWidth: 4, maxGen: 4, maxWidth: 16 } }] }));
  assert.equal(ids(r)['pcie-width'], 'critical');
});

test('RAM: un mÃ³dulo, poca cantidad y sin XMP', () => {
  const r = analyze(profile({ ram: { total: 8 * GB, available: 3 * GB, slots: 2, modules: [{ size: 8 * GB, type: 'DDR4', configuredSpeed: 2133, partNum: 'KF432C16BB/8' }] } }));
  const f = ids(r);
  assert.equal(f['ram-size'], 'warning');
  assert.equal(f['ram-single'], 'warning');
  assert.equal(f['ram-xmp'], 'warning');
});

test('Windows en disco mecÃ¡nico es crÃ­tico', () => {
  const r = analyze(profile({ disks: [{ name: 'WDC', type: 'HDD', bus: 'SATA', isSystem: true }] }));
  assert.equal(ids(r)['os-hdd'], 'critical');
});

test('monitor en vivo detecta cuello de botella de CPU', () => {
  const s = Array(5).fill({ cpu: 70, cpuMaxCore: 99, ram: 60, gpu: 55 });
  assert.equal(liveBottleneck(s).state, 'cpu-bound');
  assert.equal(liveBottleneck(Array(5).fill({ cpu: 40, cpuMaxCore: 60, ram: 50, gpu: 98 })).state, 'gpu-bound');
});
