// Planificador de mejoras: simula paso a paso qué componente conviene cambiar
// para ganar rendimiento sin crear un cuello de botella nuevo.
// Si hay un perfil de preferencias activo, las sugerencias se anclan a sus marcas y nivel de gasto.
const hw = require('./hardware');

// CPU sugerido en una plataforma nueva según el nivel de gasto.
const MODERN_PLATFORMS = {
  AMD: { key: 'AM5', label: 'Placa AM5 (B650 / B850)', mem: 'DDR5-6000 CL30', cpus: { economico: 'Ryzen 5 7600X', equilibrado: 'Ryzen 7 7800X3D', maximo: 'Ryzen 7 9800X3D' } },
  Intel: { key: 'LGA1851', label: 'Placa LGA 1851 (B860 / Z890)', mem: 'DDR5-6400', cpus: { economico: 'Core Ultra 5 245K', equilibrado: 'Core Ultra 7 265K', maximo: 'Core Ultra 9 285K' } },
};
const BUDGET_ORDER = ['economico', 'equilibrado', 'maximo'];

const round = (n, d = 1) => +(+n).toFixed(d);
const perf = (s) => Math.min(s.gpu, s.cpu, s.ceiling ?? Infinity);

function normalizePrefs(p) {
  p = p || {};
  return {
    name: p.name || null,
    cpuBrand: p.cpuBrand || null,
    gpuBrand: p.gpuBrand || null,
    gpuMaker: p.gpuMaker || null,
    boardBrand: p.boardBrand || null,
    psuBrand: p.psuBrand || null,
    ramBrand: p.ramBrand || null,
    storageBrand: p.storageBrand || null,
    budget: BUDGET_ORDER.includes(p.budget) ? p.budget : 'equilibrado',
  };
}

function planUpgrades(ctx) {
  const { cpuId, cpuEff, gpu, ceiling, platformKey, platform, chipset, resFactor, resolution, usage, ram } = ctx;
  const prefs = normalizePrefs(ctx.prefs);

  const plan = { profile: prefs.name, budget: prefs.budget, steps: [], final: null, current: null };
  if (!gpu || usage === 'office') {
    plan.final = usage === 'office'
      ? 'Para uso de oficina no hace falta mejorar CPU ni GPU: revisa los consejos de Diagnóstico.'
      : 'No se detectó una tarjeta de video para planificar mejoras.';
    return plan;
  }

  let state = {
    cpu: cpuEff,
    cpuName: cpuId.name,
    gpu: gpu.score ?? 1,
    gpuName: gpu.match?.name || gpu.name,
    gpuVram: gpu.vramGb || gpu.match?.vram || null,
    gpuPcie: gpu.pcie?.maxGen || gpu.match?.pcie || null,
    gpuLanes: gpu.pcie?.maxWidth || gpu.match?.lanes || null,
    gpuYear: gpu.match?.year || null,
    ceiling,
    platformKey,
    platform,
    slotGen: chipset?.gpuPcie ?? null,
    memType: ram.type,
  };
  plan.current = snapshot(state);
  const vramNeed = usage === 'creation' || resolution !== '1080p' ? 12 : 8;
  const opts = { resFactor, vramNeed, prefs, cpuVendor: cpuId.family?.vendor || platform?.vendor || null };

  for (let i = 0; i < 3; i++) {
    let step = nextStep(state, opts);
    // Dos cambios de GPU seguidos no tienen sentido. Si el CPU es muy antiguo, el siguiente salto
    // es una plataforma nueva; si no, la ruta termina (aún queda margen con la GPU elegida).
    if (step?.kind === 'gpu' && plan.steps.at(-1)?.kind === 'gpu') {
      step = state.cpu < hw.platforms.AM5.ceiling * resFactor * 0.6 ? platformStep(state, opts) : null;
    }
    if (!step) break;
    const before = snapshot(state);
    const prev = state;
    state = { ...state, ...step.apply };
    const after = snapshot(state);
    const gainPct = Math.round((perf(after) / perf(before) - 1) * 100);
    const notes = [step.note];
    if (gainPct < 5) notes.push('Por sí solo casi no sube los FPS con tu tarjeta actual: es la base que permite el paso siguiente.');
    plan.steps.push({
      kind: step.kind,
      title: step.title,
      pick: step.pick,
      alternatives: step.alternatives || [],
      reason: step.reason,
      note: notes.filter(Boolean).join(' ') || null,
      prefNote: step.prefNote || null,
      psu: step.psu || null,
      gainPct,
      before,
      after,
      compare: buildCompare(step.kind, prev, state, before, after, gainPct),
    });
    if (step.apply.cpuVendor) opts.cpuVendor = step.apply.cpuVendor;
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

function gpuStep(s, { vramNeed, prefs }) {
  const target = Math.min(s.cpu, s.ceiling ?? Infinity);
  const busBw = (g) => (s.slotGen && s.slotGen < g.pcie ? hw.pcieBandwidth(s.slotGen, g.lanes) : Infinity);
  // minBw 9: descarta tarjetas x8/x4 en placas PCIe 3.0 o menos (cuello de botella de bus).
  const fits = (g, minBw = 9) => !g.integrated && g.score >= s.gpu * 1.25 && g.score <= target * 1.08 && g.year >= 2022 && busBw(g) >= minBw;
  const withVram = (arr) => (arr.some((g) => g.vram >= vramNeed) ? arr.filter((g) => g.vram >= vramNeed) : arr);
  const generic = withVram(hw.gpuDb.filter((g) => fits(g)));

  let list = generic;
  let prefNote = null;
  const vendor = prefs.gpuBrand;
  if (vendor) {
    let own = withVram(generic.filter((g) => hw.gpuVendor(g) === vendor));
    // Para respetar la marca se aceptan tarjetas x8 en PCIe 3.0 (pérdida pequeña), nunca x4.
    if (!own.length) own = withVram(hw.gpuDb.filter((g) => fits(g, 7.5) && hw.gpuVendor(g) === vendor));
    if (own.length) list = own;
    else if (generic.length) prefNote = `No hay una tarjeta ${vendor} que mejore tu equipo sin cuello de botella; se muestra la mejor opción de otra marca.`;
  }
  if (!list.length) return null;
  list = [...list].sort((a, b) => b.score - a.score);

  const pick = pickGpu(list, prefs.budget, target, s.gpu);
  const others = list.filter((g) => g !== pick);
  const economic = pickGpu(others.filter((g) => g.score < pick.score), 'economico', target, s.gpu);
  if (busBw(pick) < 9) prefNote = [prefNote, `La ${pick.name} usa ${pick.lanes} carriles: en tu placa PCIe ${s.slotGen}.0 pierde ≈ 3-8 % de rendimiento.`].filter(Boolean).join(' ');
  const alternatives = others.slice(0, 3);
  if (economic && !alternatives.includes(economic) && prefs.budget !== 'economico') alternatives.push(economic);

  const maker = gpuMakerLabel(pick, prefs);
  if (maker.note) prefNote = [prefNote, maker.note].filter(Boolean).join(' ');
  const watts = hw.psuWatts(pick.score);
  const psuSeries = prefs.psuBrand ? hw.brands.psu[prefs.psuBrand] : null;

  return {
    kind: 'gpu',
    title: 'Cambiar la tarjeta de video',
    pick: `${pick.name} (${pick.vram} GB)${maker.label ? ` · ${maker.label}` : ''}`,
    alternatives: alternatives.map((g) => `${g.name}${g === economic ? ' · opción económica' : ''}`),
    reason: `Tu ${s.gpuName} (${s.gpu}) es lo que más frena el equipo. Tu procesador y tu placa pueden alimentar una tarjeta de hasta ≈ ${round(target)} puntos sin cuello de botella.`,
    note: 'Revisa que la tarjeta quepa en tu gabinete.',
    prefNote,
    psu: psuSeries ? `Fuente recomendada: ≈ ${watts} W 80 Plus Gold (${psuSeries}).` : null, // los vatios ya salen en la comparativa
    apply: { gpu: pick.score, gpuName: pick.name, gpuVram: pick.vram, gpuPcie: pick.pcie, gpuLanes: pick.lanes, gpuYear: pick.year },
  };
}

// list ordenada de mayor a menor puntaje.
function pickGpu(list, budget, target, current) {
  if (!list.length) return null;
  const recent = list.filter((g) => g.year >= 2024);
  const pool = recent.length ? recent : list;
  if (budget === 'maximo') return pool[0];
  if (budget === 'economico') {
    const ok = list.filter((g) => g.score >= Math.max(current * 1.4, target * 0.55));
    return (ok.length ? ok : list).at(-1);
  }
  // Equilibrado: la más cercana al 85 % de lo que puede alimentar el procesador.
  return pool.reduce((best, g) => (Math.abs(g.score - target * 0.85) <= Math.abs(best.score - target * 0.85) ? g : best));
}

function gpuMakerLabel(gpuEntry, prefs) {
  if (!prefs.gpuMaker) return {};
  const vendor = hw.gpuVendor(gpuEntry);
  const makers = hw.brands.gpuMakers[vendor] || [];
  if (!makers.includes(prefs.gpuMaker)) {
    return { note: `${prefs.gpuMaker} no fabrica tarjetas ${vendor}; elige una versión de ${makers.slice(0, 3).join(', ')}.` };
  }
  return { label: `versión ${prefs.gpuMaker} ${hw.brands.gpuSeries[prefs.gpuMaker] || ''}`.trim() };
}

function cpuStep(s, { resFactor, prefs, cpuVendor }) {
  if (!s.platform) return null;
  const options = s.platform.bestCpus
    .map((name) => ({ name, score: round(hw.identifyCpu(name).score * resFactor) }))
    .filter((c) => c.score > s.cpu * 1.12)
    .sort((a, b) => b.score - a.score);
  if (!options.length) return null;
  // Basta con el CPU que deja de frenar a la GPU actual; si ninguno basta, el más potente.
  const enough = options.filter((c) => c.score >= s.gpu * 1.05).at(-1);
  const pick = prefs.budget === 'maximo' ? options[0] : prefs.budget === 'economico' ? enough || options.at(-1) : enough || options[0];

  let prefNote = null;
  const alternatives = options.filter((c) => c !== pick).map((c) => c.name);
  const vendor = s.platform.vendor;
  if (prefs.cpuBrand && vendor && prefs.cpuBrand !== vendor) {
    const alt = MODERN_PLATFORMS[prefs.cpuBrand];
    prefNote = `Prefieres ${prefs.cpuBrand}, pero tu placa es para ${vendor}: esta mejora conserva tu placa y es la más barata. Para pasarte a ${prefs.cpuBrand} necesitas cambiar placa, CPU y RAM.`;
    alternatives.push(`Pasarte a ${prefs.cpuBrand}: ${boardLabel(alt, prefs)} + ${alt.cpus[prefs.budget]}`);
  }
  return {
    kind: 'cpu',
    title: 'Cambiar el procesador (misma placa)',
    pick: pick.name,
    alternatives,
    reason: `Tu procesador (${s.cpu}) ya es el límite para la ${s.gpuName} (${s.gpu}). El ${pick.name} (${pick.score}) es compatible con tu placa y le da margen a la GPU.`,
    note: s.platform.note || (cpuVendor === 'Intel' ? 'Actualiza la BIOS antes de instalar el nuevo procesador.' : null),
    prefNote,
    apply: { cpu: pick.score, cpuName: pick.name },
  };
}

function platformStep(s, { resFactor, prefs }) {
  if (s.platform && !s.platform.eol) return null; // plataforma vigente y ya al máximo
  const order = prefs.cpuBrand === 'Intel' ? ['Intel', 'AMD'] : ['AMD', 'Intel'];
  const [main, alt] = order.map((v) => MODERN_PLATFORMS[v]);
  const ceiling = round(hw.platforms[main.key].ceiling * resFactor);

  // Sube de nivel de gasto si el CPU elegido no mejora lo suficiente.
  let cpuName = null;
  let cpuScore = 0;
  for (const b of BUDGET_ORDER.slice(BUDGET_ORDER.indexOf(prefs.budget))) {
    cpuName = main.cpus[b];
    cpuScore = round(hw.identifyCpu(cpuName).score * resFactor);
    if (cpuScore > s.cpu * 1.12) break;
  }
  if (cpuScore <= s.cpu * 1.12) return null;

  const ramSeries = prefs.ramBrand ? hw.brands.ram[prefs.ramBrand] : null;
  const notes = [s.memType && s.memType !== 'DDR5' ? `Tu RAM ${s.memType} no sirve en la nueva placa: necesitarás DDR5.` : null];
  return {
    kind: 'platform',
    title: 'Cambiar placa, procesador y RAM',
    pick: `${boardLabel(main, prefs)} + ${cpuName} + 32 GB ${main.mem}${ramSeries ? ` (${ramSeries})` : ''}`,
    alternatives: [`${boardLabel(alt, prefs)} + ${alt.cpus[prefs.budget]} + 32 GB ${alt.mem}`],
    reason: `Tu plataforma ${s.platform?.socket || 'actual'} ya no admite un procesador mejor: para seguir subiendo de tarjeta sin cuello de botella necesitas una plataforma moderna, con techo para GPUs de gama alta durante varios años.`,
    note: notes.filter(Boolean).join(' ') || null,
    psu: prefs.psuBrand ? `Si cambias también la fuente: ${hw.brands.psu[prefs.psuBrand]}.` : null,
    apply: { cpu: cpuScore, cpuName, ceiling, platformKey: main.key, platform: hw.platforms[main.key], slotGen: 5, memType: 'DDR5', cpuVendor: order[0] },
  };
}

function boardLabel(platformDef, prefs) {
  const branded = prefs.boardBrand && hw.brands.boards[prefs.boardBrand]?.[platformDef.key];
  return branded ? `Placa ${branded}` : platformDef.label;
}

// Tabla "antes / después" con las diferencias concretas del componente que cambia.
function buildCompare(kind, a, b, before, after, gainPct) {
  const pct = (x, y) => (x && y ? `${y >= x ? '+' : ''}${Math.round((y / x - 1) * 100)}%` : '');
  const state = (snap) => (snap.balanced ? 'Sin cuello de botella' : `Limita ${limiterLabel(snap.limiter)}`);
  const link = (s) => (s.gpuPcie && s.gpuLanes ? `PCIe ${s.slotGen ? Math.min(s.slotGen, s.gpuPcie) : s.gpuPcie}.0 x${s.gpuLanes}` : '—');
  const rows = [];
  if (kind === 'gpu') {
    rows.push(
      { label: 'Tarjeta de video', before: a.gpuName, after: b.gpuName },
      { label: 'Potencia de la tarjeta', before: round(a.gpu), after: round(b.gpu), diff: pct(a.gpu, b.gpu) },
      { label: 'Memoria de video (VRAM)', before: a.gpuVram ? `${a.gpuVram} GB` : '—', after: `${b.gpuVram} GB`, diff: a.gpuVram ? `${b.gpuVram - a.gpuVram >= 0 ? '+' : ''}${round(b.gpuVram - a.gpuVram)} GB` : '' },
      { label: 'Enlace en tu placa', before: link(a), after: link(b) },
      { label: 'Generación', before: a.gpuYear || '—', after: b.gpuYear },
      { label: 'Fuente recomendada', before: `≈ ${hw.psuWatts(a.gpu)} W`, after: `≈ ${hw.psuWatts(b.gpu)} W`, diff: hw.psuWatts(b.gpu) > hw.psuWatts(a.gpu) ? 'Revisa tu fuente' : 'Igual' }
    );
  } else if (kind === 'cpu') {
    rows.push(
      { label: 'Procesador', before: a.cpuName, after: b.cpuName },
      { label: 'Potencia del procesador', before: round(a.cpu), after: round(b.cpu), diff: pct(a.cpu, b.cpu) },
      { label: 'Placa madre', before: a.platform?.socket || '—', after: 'Se mantiene' }
    );
  } else {
    rows.push(
      { label: 'Procesador', before: a.cpuName, after: b.cpuName },
      { label: 'Potencia del procesador', before: round(a.cpu), after: round(b.cpu), diff: pct(a.cpu, b.cpu) },
      { label: 'Plataforma', before: a.platform?.socket || '—', after: b.platform?.socket },
      { label: 'Memoria RAM', before: a.memType || '—', after: b.memType },
      { label: 'Slot de la tarjeta', before: a.slotGen ? `PCIe ${a.slotGen}.0` : '—', after: `PCIe ${b.slotGen}.0` },
      { label: 'Techo de GPU de la placa', before: a.ceiling ? round(a.ceiling) : '—', after: round(b.ceiling), diff: pct(a.ceiling, b.ceiling) }
    );
  }
  rows.push(
    { label: 'Rendimiento en tu equipo', before: round(before.perf), after: round(after.perf), diff: gainPct < 5 ? 'Base' : `+${gainPct}%`, highlight: true },
    { label: 'Equilibrio', before: state(before), after: state(after), good: after.balanced }
  );
  return rows;
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

module.exports = { planUpgrades, normalizePrefs, MODERN_PLATFORMS };
