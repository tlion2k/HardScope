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

test('identifica GPUs eligiendo el nombre más específico', () => {
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

test('lee la velocidad nominal desde el número de parte', () => {
  assert.equal(hw.ratedSpeedFromPart('AX5U5200C3816G-BLARB'), 5200);
  assert.equal(hw.ratedSpeedFromPart('KF432C16BB/8'), 3200);
  assert.equal(hw.ratedSpeedFromPart('CMK16GX4M2B3200C16'), 3200);
});

test('equipo equilibrado no genera alertas críticas', () => {
  const r = analyze(profile());
  assert.equal(r.counts.critical, 0);
  assert.equal(r.balance.boardVsGpu.verdict, 'balanced');
});

test('placa vieja con GPU de gama alta: la placa no aprovecha la tarjeta', () => {
  const r = analyze(profile({ board: { model: 'PRIME A320M-K' }, cpu: { brand: 'AMD Ryzen 5 1600', cores: 12, physicalCores: 6 }, gpus: [{ name: 'NVIDIA GeForce RTX 5090', vram: 32768 }] }));
  assert.equal(r.balance.boardVsGpu.verdict, 'gpu');
  assert.equal(ids(r)['board-limits-gpu'], 'critical');
  assert.equal(ids(r)['cpu-bottleneck'], 'critical');
});

test('placa moderna con GPU débil: la placa es superior', () => {
  const r = analyze(profile({ board: { model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'NVIDIA GeForce GTX 1650', vram: 4096 }] }));
  assert.equal(r.balance.boardVsGpu.verdict, 'board');
  assert.equal(ids(r)['board-superior'], 'warning');
  assert.match(r.findings.find((f) => f.id === 'board-superior').action, /RTX|RX|Arc/);
});

test('RX 6500 XT (x4) en placa PCIe 3.0 es crítico', () => {
  const r = analyze(profile({ board: { model: 'B450 TOMAHAWK MAX' }, gpus: [{ name: 'AMD Radeon RX 6500 XT', vram: 4096 }] }));
  assert.equal(ids(r)['pcie-gen'], 'critical');
});

test('GPU corriendo con menos carriles de los que tiene', () => {
  const r = analyze(profile({ gpus: [{ name: 'NVIDIA GeForce RTX 3060', vram: 12288, pcie: { curGen: 4, curWidth: 4, maxGen: 4, maxWidth: 16 } }] }));
  assert.equal(ids(r)['pcie-width'], 'critical');
});

test('RAM: un módulo, poca cantidad y sin XMP', () => {
  const r = analyze(profile({ ram: { total: 8 * GB, available: 3 * GB, slots: 2, modules: [{ size: 8 * GB, type: 'DDR4', configuredSpeed: 2133, partNum: 'KF432C16BB/8' }] } }));
  const f = ids(r);
  assert.equal(f['ram-size'], 'warning');
  assert.equal(f['ram-single'], 'warning');
  assert.equal(f['ram-xmp'], 'warning');
});

test('Windows en disco mecánico es crítico', () => {
  const r = analyze(profile({ disks: [{ name: 'WDC', type: 'HDD', bus: 'SATA', isSystem: true }] }));
  assert.equal(ids(r)['os-hdd'], 'critical');
});

test('monitor en vivo detecta cuello de botella de CPU', () => {
  const s = Array(5).fill({ cpu: 70, cpuMaxCore: 99, ram: 60, gpu: 55 });
  assert.equal(liveBottleneck(s).state, 'cpu-bound');
  assert.equal(liveBottleneck(Array(5).fill({ cpu: 40, cpuMaxCore: 60, ram: 50, gpu: 98 })).state, 'gpu-bound');
});

test('plan de mejora: GPU débil en plataforma moderna -> cambiar GPU y queda equilibrado', () => {
  const r = analyze(profile({ board: { model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'NVIDIA GeForce GTX 1650', vram: 4096 }] }));
  const [first] = r.upgrades.steps;
  assert.equal(first.kind, 'gpu');
  assert.ok(first.gainPct > 100);
  assert.equal(first.after.balanced, true);
  assert.ok(first.after.gpu <= first.before.cpu * 1.08, 'la GPU sugerida no debe superar al CPU');
});

test('plan de mejora: CPU que frena a la GPU -> primero el procesador compatible', () => {
  const r = analyze(profile({ cpu: { brand: 'AMD Ryzen 5 3600', cores: 12, physicalCores: 6 }, gpus: [{ name: 'NVIDIA GeForce RTX 4070 SUPER', vram: 12288 }] }));
  assert.equal(r.upgrades.steps[0].kind, 'cpu');
  assert.match(r.upgrades.steps[0].pick, /5700X3D|5800X3D/);
});

test('plan de mejora: plataforma agotada -> cambio de placa', () => {
  const r = analyze(profile({ board: { model: 'Z97-A' }, cpu: { brand: 'Intel Core i7-4790K', cores: 8, physicalCores: 4 }, gpus: [{ name: 'NVIDIA GeForce RTX 3060', vram: 12288 }], ram: { total: 16 * GB, slots: 4, modules: [{ size: 8 * GB, type: 'DDR3', configuredSpeed: 1600 }, { size: 8 * GB, type: 'DDR3', configuredSpeed: 1600 }] } }));
  const step = r.upgrades.steps[0];
  assert.equal(step.kind, 'platform');
  assert.match(step.note, /DDR5/);
});

test('perfil: la GPU sugerida respeta la marca preferida y la ensambladora', () => {
  const prefs = { name: 'Jorge', cpuBrand: 'AMD', gpuBrand: 'NVIDIA', gpuMaker: 'ASUS', psuBrand: 'Corsair', budget: 'equilibrado' };
  const r = analyze(profile({ board: { model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'AMD Radeon RX 6600', vram: 8192 }] }), { prefs });
  const step = r.upgrades.steps[0];
  assert.match(step.pick, /GeForce/);
  assert.match(step.pick, /ASUS/);
  assert.match(step.psu, /Corsair/);
  assert.equal(r.settings.profile, 'Jorge');
  assert.match(r.findings.find((f) => f.id === 'board-superior').action, /GeForce/);
});

test('perfil: sin perfil se mantiene la vista global', () => {
  const r = analyze(profile({ board: { model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'AMD Radeon RX 6600', vram: 8192 }] }));
  assert.equal(r.settings.profile, null);
  assert.equal(r.upgrades.steps[0].prefNote, null);
});

test('perfil: plataforma nueva con la marca de CPU y placa elegidas', () => {
  const ddr3 = { total: 16 * GB, slots: 4, modules: [{ size: 8 * GB, type: 'DDR3', configuredSpeed: 1600 }, { size: 8 * GB, type: 'DDR3', configuredSpeed: 1600 }] };
  const pc = profile({ board: { model: 'Z97-A' }, cpu: { brand: 'Intel Core i7-4790K', cores: 8, physicalCores: 4 }, gpus: [{ name: 'NVIDIA GeForce RTX 3060', vram: 12288 }], ram: ddr3 });
  const intel = analyze(pc, { prefs: { cpuBrand: 'Intel', boardBrand: 'MSI' } }).upgrades.steps[0];
  assert.match(intel.pick, /MSI .*B860|Z890/);
  assert.match(intel.pick, /Core Ultra/);
  const amd = analyze(pc, { prefs: { cpuBrand: 'AMD', boardBrand: 'ASUS', budget: 'maximo' } }).upgrades.steps[0];
  assert.match(amd.pick, /ASUS .*B650|B850/);
  assert.match(amd.pick, /9800X3D/);
});

test('perfil: nivel de gasto económico elige una GPU más barata que el máximo', () => {
  const pc = profile({ board: { model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'NVIDIA GeForce GTX 1650', vram: 4096 }] });
  const eco = analyze(pc, { prefs: { budget: 'economico' } }).upgrades.steps[0].after.gpu;
  const max = analyze(pc, { prefs: { budget: 'maximo' } }).upgrades.steps[0].after.gpu;
  assert.ok(eco < max);
});
test('actual vs perfil: Intel -> perfil AMD exige placa y procesador, con opciones equivalentes o superiores', () => {
  const pc = profile({ board: { manufacturer: 'ASRock', model: 'Z790 PG Lightning' }, cpu: { brand: 'Intel Core i5-14600KF', cores: 20, physicalCores: 14 }, ram: { total: 32 * GB, slots: 4, modules: [{ size: 16 * GB, type: 'DDR5', configuredSpeed: 4800, manufacturer: 'A-DATA Technology' }, { size: 16 * GB, type: 'DDR5', configuredSpeed: 4800, manufacturer: 'A-DATA Technology' }] } });
  const m = analyze(pc, { prefs: { name: 'Jorge', cpuBrand: 'AMD', boardBrand: 'MSI', ramBrand: 'Kingston' } }).profileMatch;
  const row = (k) => m.rows.find((r) => r.key === k);
  assert.deepEqual(m.required, ['cpu', 'board']);
  const cpu = row('cpu').options;
  assert.equal(cpu[0].tier, 'Equivalente');
  assert.match(cpu[0].name, /Ryzen/);
  assert.ok(cpu.every((o) => !o.diff.startsWith('-')), 'ninguna opción rinde menos que el CPU actual');
  assert.match(row('board').options[0].name, /MSI .*X870/); // Z790 es gama alta -> X870
  assert.equal(row('ram').status, 'optional'); // DDR5 sirve; sólo cambia la marca
  assert.equal(m.found.ram, 'ADATA XPG');
});

test('actual vs perfil: DDR4 al cambiar de plataforma obliga a cambiar la RAM', () => {
  const m = analyze(profile(), { prefs: { name: 'X', cpuBrand: 'Intel' } }).profileMatch;
  assert.ok(m.required.includes('ram'));
  assert.match(m.rows.find((r) => r.key === 'ram').options[0].name, /DDR5/);
});

test('actual vs perfil: GPU de otra marca -> opciones de la marca pedida', () => {
  const m = analyze(profile({ gpus: [{ name: 'AMD Radeon RX 7800 XT', vram: 16384 }] }), { prefs: { name: 'X', gpuBrand: 'NVIDIA' } }).profileMatch;
  const gpu = m.rows.find((r) => r.key === 'gpu');
  assert.equal(gpu.status, 'change');
  assert.ok(gpu.options.length && gpu.options.every((o) => /GeForce/.test(o.name)));
});

test('actual vs perfil: sin perfil no hay comparación y con perfil coincidente no hay cambios', () => {
  assert.equal(analyze(profile()).profileMatch, null);
  const m = analyze(profile(), { prefs: { name: 'X', cpuBrand: 'AMD', gpuBrand: 'NVIDIA' } }).profileMatch;
  assert.equal(m.required.length, 0);
});
test('fase 1: avisos de datos faltantes no bajan el índice y se informan', () => {
  const base = analyze(profile()).health;
  const r = analyze(profile({ gpus: [{ name: 'GPU Misteriosa X1', vram: 8192 }], issues: [{ area: 'system', text: 'No se pudo leer X' }] }));
  assert.ok(r.findings.some((f) => f.id === 'gpu-unknown'));
  assert.ok(r.health >= base - 2, 'gpu-unknown no penaliza');
  assert.equal(r.dataIssues.length, 1);
});

test('fase 1: el límite de CPU sólo es crítico con una diferencia muy grande y se presenta como estimación', () => {
  const r = analyze(profile({ cpu: { brand: 'AMD Ryzen 5 3600', cores: 12, physicalCores: 6 }, gpus: [{ name: 'NVIDIA GeForce RTX 4070 SUPER', vram: 12288 }] }));
  const f = r.findings.find((x) => x.id === 'cpu-bottleneck');
  assert.equal(f.severity, 'warning');
  assert.match(f.detail, /estimado/);
  assert.match(f.detail, /Monitor en vivo/);
});

test('fase 1: dos módulos en el mismo canal se detectan por la etiqueta de ranura', () => {
  const mods = [{ size: 8 * GB, type: 'DDR4', configuredSpeed: 3200, locator: 'ChannelA-DIMM0' }, { size: 8 * GB, type: 'DDR4', configuredSpeed: 3200, locator: 'ChannelA-DIMM1' }];
  const r = analyze(profile({ ram: { total: 16 * GB, slots: 4, modules: mods } }));
  assert.equal(r.components.ram.channel, 'single');
  assert.ok(r.findings.some((f) => f.id === 'ram-same-channel'));
  const ok = analyze(profile({ ram: { total: 16 * GB, slots: 4, modules: [{ ...mods[0] }, { ...mods[1], locator: 'ChannelB-DIMM1' }] } }));
  assert.equal(ok.components.ram.channel, 'dual');
});

test('fase 1: el monitor no diagnostica sin lectura de la GPU', () => {
  assert.equal(liveBottleneck(Array(5).fill({ cpu: 90, cpuMaxCore: 100, ram: 50, gpu: null })).state, 'no-gpu-data');
});

test('fase 2: cada mejora trae su lista de verificación antes de comprar', () => {
  const gpuStep = analyze(profile({ board: { manufacturer: 'Gigabyte', model: 'B650 AORUS ELITE' }, cpu: { brand: 'AMD Ryzen 7 7700X', cores: 16, physicalCores: 8 }, gpus: [{ name: 'NVIDIA GeForce GTX 1650', vram: 4096 }] })).upgrades.steps[0];
  assert.ok(gpuStep.checks.some((c) => /Tamaño/.test(c)) && gpuStep.checks.some((c) => /conectores/.test(c)));
  const cpuStep = analyze(profile({ board: { manufacturer: 'MSI', model: 'B450 TOMAHAWK' }, cpu: { brand: 'AMD Ryzen 5 3600', cores: 12, physicalCores: 6 }, gpus: [{ name: 'NVIDIA GeForce RTX 4070 SUPER', vram: 12288 }] })).upgrades.steps[0];
  assert.equal(cpuStep.kind, 'cpu');
  assert.match(cpuStep.checks[0], /MSI .*B450 TOMAHAWK/);
  const m = analyze(profile(), { prefs: { name: 'X', cpuBrand: 'Intel' } }).profileMatch;
  assert.ok(m.rows.find((r) => r.key === 'cpu').checks.some((c) => /BIOS/.test(c)));
});

test('fase 2: en un portátil no se sugieren cambios de CPU, placa ni GPU', () => {
  const laptop = profile({ system: { laptop: true }, cpu: { brand: 'Intel Core i5-8250U', cores: 8, physicalCores: 4 }, gpus: [{ name: 'NVIDIA GeForce RTX 4090 Laptop GPU', vram: 16384 }] });
  const r = analyze(laptop);
  assert.equal(r.upgrades.steps.length, 0);
  assert.match(r.upgrades.final, /portátil/);
  assert.equal(r.balance.boardVsGpu.verdict, 'laptop');
  assert.match(r.findings.find((f) => f.id === 'cpu-bottleneck').action, /portátil/);
  const m = analyze(laptop, { prefs: { name: 'X', cpuBrand: 'AMD' } }).profileMatch;
  assert.equal(m.required.length, 0);
});

test('fase 2: se puede elegir qué tarjeta analizar cuando hay varias', () => {
  const two = profile({ gpus: [{ name: 'NVIDIA GeForce RTX 4070 SUPER', vram: 12288 }, { name: 'NVIDIA GeForce GTX 1650', vram: 4096 }] });
  assert.equal(analyze(two).components.gpu.name, 'NVIDIA GeForce RTX 4070 SUPER');
  assert.equal(analyze(two, { primaryGpu: 'NVIDIA GeForce GTX 1650' }).components.gpu.name, 'NVIDIA GeForce GTX 1650');
});
test('fase 3: cada hallazgo trae versión simple y, los comparativos, evidencia técnica', () => {
  const r = analyze(profile({ cpu: { brand: 'AMD Ryzen 5 3600', cores: 12, physicalCores: 6 }, gpus: [{ name: 'NVIDIA GeForce RTX 4070 SUPER', vram: 12288 }] }));
  for (const f of r.findings) {
    assert.ok(f.plain?.title, `sin título simple: ${f.id}`);
    assert.ok(Array.isArray(f.evidence), `sin evidencia: ${f.id}`);
  }
  const cpu = r.findings.find((f) => f.id === 'cpu-bottleneck');
  assert.doesNotMatch(cpu.plain.title, /\d/, 'el título simple no lleva números');
  const ev = Object.fromEntries(cpu.evidence);
  assert.equal(ev['Relación GPU/CPU'], String(r.balance.cpuVsGpu.ratio));
  assert.match(ev['Umbrales'], /1,60/);
  assert.doesNotMatch(r.findings.find((f) => f.id === 'gpu-weak-vs-cpu' || f.id === 'board-superior')?.plain.action || '', /≈/);
});