// Planificador de mejoras: simula paso a paso qué componente conviene cambiar
// para ganar rendimiento sin crear un cuello de botella nuevo.
const hw = require('./hardware');

const QUICK_FIXES = {
  'ram-xmp': 'Gratis',
  'power-plan': 'Gratis',
  'pcie-width': 'Gratis',
  'disk-space': 'Gratis',
  'ram-single': 'Bajo costo',
  'ram-size': 'Bajo costo',
  'ram-mixed': 'Bajo costo',
  'os-hdd': 'Bajo costo',
};

const MODERN_PLATFORMS = [
  { key: 'AM5', board: 'Placa AM5 (B650 / B850)', cpu: 'Ryzen 7 7800X3D', mem: 'DDR5-6000 CL30' },
  { key: 'LGA1851', board: 'Placa LGA 1851 (B860 / Z890)', cpu: 'Core Ultra 7 265K', mem: 'DDR5-6400' },
];

const round = (n, d = 1) => +(+n).toFixed(d);
const perf = (s) => Math.min(s.gpu, s.cpu, s.ceiling ?? Infinity);

function planUpgrades(ctx) {
  const { cpuId, cpuEff, gpu, ceiling, platformKey, platform, chipset, resFactor, resolution, usage, findings, ram } = ctx;

  const quickFixes = findings
    .filter((f) => QUICK_FIXES[f.id] && (f.severity === 'critical' || f.severity === 'warning'))
    .map((f) => ({ id: f.id, cost: QUICK_FIXES[f.id], severity: f.severity, component: f.component, title: f.title, action: f.action }))
    .sort((a, b) => (a.cost === 'Gratis' ? -1 : 1) - (b.cost === 'Gratis' ? -1 : 1));

  const plan = { quickFixes, steps: [], final: null, current: null };
  if (!gpu || usage === 'office') {
    plan.final = usage === 'office'
      ? 'Para uso de oficina no hace falta mejorar CPU ni GPU: con las mejoras rápidas basta.'
      : 'No se detectó una tarjeta de video para planificar mejoras.';
    return plan;
  }

  let state = {
    cpu: cpuEff,
    cpuName: cpuId.name,
    gpu: gpu.score ?? 1,
    gpuName: gpu.match?.name || gpu.name,
    ceiling,
    platformKey,
    platform,
    slotGen: chipset?.gpuPcie ?? null,
    memType: ram.type,
  };
  plan.current = snapshot(state);
  const vramNeed = usage === 'creation' || resolution !== '1080p' ? 12 : 8;

  for (let i = 0; i < 3; i++) {
    const step = nextStep(state, { resFactor, vramNeed, cpuId: i === 0 ? cpuId : null });
    if (!step) break;
    const before = snapshot(state);
    state = { ...state, ...step.apply };
    const after = snapshot(state);
    const gainPct = Math.round((perf(after) / perf(before) - 1) * 100);
    if (gainPct < 5) step.note = [step.note, 'Por sí solo casi no sube los FPS con tu tarjeta actual: es la base que permite el paso siguiente.'].filter(Boolean).join(' ');
    plan.steps.push({
      kind: step.kind,
      title: step.title,
      pick: step.pick,
      alternatives: step.alternatives || [],
      reason: step.reason,
      note: step.note || null,
      gainPct,
      before,
      after,
    });
  }

  // Un paso final que casi no aporta no se recomienda: sólo sirve si prepara otro paso.
  while (plan.steps.length && plan.steps.at(-1).gainPct < 5) plan.steps.pop();

  const last = plan.steps.at(-1)?.after || plan.current;
  plan.final = plan.steps.length
    ? last.balanced
      ? 'Con esta ruta el equipo queda equilibrado: ningún componente frena a los demás.'
      : `Después de estos pasos, el siguiente límite será ${limiterLabel(last.limiter)}.`
    : 'Tu equipo ya está en lo más alto de su combinación: no hay una mejora individual que suba el rendimiento sin crear un cuello de botella.';
  return plan;
}

function nextStep(s, opts) {
  const top = Math.min(s.cpu, s.ceiling ?? Infinity);
  if (s.gpu <= top * 0.9) return gpuStep(s, opts) || null;
  // La GPU ya aprovecha al CPU: el siguiente salto pasa por el procesador.
  return cpuStep(s, opts) || platformStep(s, opts);
}

function gpuStep(s, { vramNeed }) {
  const target = Math.min(s.cpu, s.ceiling ?? Infinity);
  const fits = (g) => {
    if (g.integrated || g.score < s.gpu * 1.25 || g.score > target * 1.08 || g.year < 2022) return false;
    // Evita tarjetas x8/x4 en placas PCIe 3.0 o menos: crearían un cuello de botella de bus.
    if (s.slotGen && s.slotGen < g.pcie && hw.pcieBandwidth(s.slotGen, g.lanes) < 9) return false;
    return true;
  };
  let list = hw.gpuDb.filter((g) => fits(g) && g.vram >= vramNeed);
  if (!list.length) list = hw.gpuDb.filter(fits);
  if (!list.length) return null;
  list.sort((a, b) => b.score - a.score);
  const recent = list.filter((g) => g.year >= 2024);
  const pick = (recent[0] || list[0]);
  // Opción económica: la más modesta que todavía queda equilibrada con el CPU (≥ 55 % del techo).
  const economic = list.filter((g) => g.score >= Math.max(s.gpu * 1.4, target * 0.55) && g !== pick).at(-1);
  const alternatives = list.filter((g) => g !== pick).slice(0, 3);
  if (economic && !alternatives.includes(economic)) alternatives.push(economic);
  return {
    kind: 'gpu',
    title: 'Cambiar la tarjeta de video',
    pick: `${pick.name} (${pick.vram} GB)`,
    alternatives: alternatives.map((g) => `${g.name}${g === economic ? ' · opción económica' : ''}`),
    reason: `Tu ${s.gpuName} (${s.gpu}) es lo que más frena el equipo. Tu procesador y tu placa pueden alimentar una tarjeta de hasta ≈ ${round(target)} puntos sin cuello de botella.`,
    note: 'Revisa que tu fuente de poder cumpla la potencia mínima que indica el fabricante de la tarjeta y que quepa en tu gabinete.',
    apply: { gpu: pick.score, gpuName: pick.name },
  };
}

function cpuStep(s, { resFactor, cpuId }) {
  if (!s.platform) return null;
  const options = s.platform.bestCpus
    .map((name) => ({ name, score: round(hw.identifyCpu(name).score * resFactor) }))
    .filter((c) => c.score > s.cpu * 1.12)
    .sort((a, b) => b.score - a.score);
  if (!options.length) return null;
  // Basta con el CPU que deja de frenar a la GPU actual; si ninguno basta, el más potente.
  const enough = options.filter((c) => c.score >= s.gpu * 1.05).at(-1);
  const pick = enough || options[0];
  return {
    kind: 'cpu',
    title: 'Cambiar el procesador (misma placa)',
    pick: pick.name,
    alternatives: options.filter((c) => c !== pick).map((c) => c.name),
    reason: `Tu procesador (${s.cpu}) ya es el límite para la ${s.gpuName} (${s.gpu}). El ${pick.name} (${pick.score}) es compatible con tu placa y le da margen a la GPU.`,
    note: s.platform.note || (cpuId?.family?.vendor === 'Intel' ? 'Actualiza la BIOS antes de instalar el nuevo procesador.' : null),
    apply: { cpu: pick.score, cpuName: pick.name },
  };
}

function platformStep(s, { resFactor }) {
  if (s.platform && !s.platform.eol) return null; // plataforma vigente y ya al máximo
  const [main, alt] = MODERN_PLATFORMS;
  const cpuScore = round(hw.identifyCpu(main.cpu).score * resFactor);
  const ceiling = round(hw.platforms[main.key].ceiling * resFactor);
  if (cpuScore <= s.cpu * 1.12) return null;
  return {
    kind: 'platform',
    title: 'Cambiar placa, procesador y RAM',
    pick: `${main.board} + ${main.cpu} + 32 GB ${main.mem}`,
    alternatives: [`${alt.board} + ${alt.cpu} + 32 GB ${alt.mem}`],
    reason: `Tu plataforma ${s.platform?.socket || 'actual'} ya no admite un procesador mejor: para seguir subiendo de tarjeta sin cuello de botella necesitas una plataforma moderna, con techo para GPUs de gama alta durante varios años.`,
    note: s.memType && s.memType !== 'DDR5' ? `Tu RAM ${s.memType} no sirve en la nueva placa: necesitarás DDR5.` : null,
    apply: { cpu: cpuScore, cpuName: main.cpu, ceiling, platformKey: main.key, platform: hw.platforms[main.key], slotGen: 5, memType: 'DDR5' },
  };
}

function snapshot(s) {
  const ratio = s.gpu / s.cpu;
  const overCeiling = s.ceiling && s.gpu > s.ceiling * 1.1;
  let limiter = 'none';
  if (overCeiling) limiter = 'board';
  else if (ratio > 1.1) limiter = 'cpu';
  else if (ratio < 0.5) limiter = 'gpu';
  return {
    cpu: round(s.cpu),
    gpu: round(s.gpu),
    ceiling: s.ceiling ? round(s.ceiling) : null,
    cpuName: s.cpuName,
    gpuName: s.gpuName,
    perf: round(perf(s)),
    limiter,
    balanced: limiter === 'none',
  };
}

function limiterLabel(l) {
  return { cpu: 'el procesador', gpu: 'la tarjeta de video', board: 'la placa', none: 'ninguno' }[l];
}

module.exports = { planUpgrades };
