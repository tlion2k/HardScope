// Compara el equipo actual con el perfil de preferencias: qué cumple, qué hay que cambiar
// (con opciones equivalentes o superiores) y qué cambios son sólo opcionales.
const hw = require('./hardware');
const { modern } = require('../data/platforms.json');

const BUDGET_TARGET = { economico: 'equivalent', equilibrado: 'superior', maximo: 'superior' };
const round = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => `${b >= a ? '+' : ''}${Math.round((b / a - 1) * 100)}%`;

function brandOf(text, map, { prefix = false } = {}) {
  const t = String(text || '').toUpperCase().trim();
  if (!t) return null;
  for (const [key, brand] of Object.entries(map)) {
    // Las claves cortas (CT, ST, F4-) sólo valen como prefijo para no confundirse dentro de otras palabras.
    if (prefix ? t.startsWith(key) : key.length >= 4 && t.includes(key)) return brand;
  }
  return null;
}

function detectBrands(profile, gpu) {
  const a = hw.brands.aliases;
  const mod = profile.ram?.modules?.[0] || {};
  const sys = (profile.disks || []).find((d) => d.isSystem);
  return {
    board: brandOf(profile.board?.manufacturer, a.board),
    gpuMaker: gpu?.maker || null,
    ram: brandOf(mod.manufacturer, a.ram) || brandOf(mod.partNum, a.ram, { prefix: true }),
    storage: sys ? brandOf(sys.name, a.storage, { prefix: true }) || brandOf(sys.name, a.storage) : null,
  };
}

// Opciones de CPU de la marca deseada: la equivalente (≈ igual) y las superiores.
function cpuOptions(vendor, currentScore) {
  const list = modern[vendor].cpus.map((name) => ({ name, score: hw.identifyCpu(name).score })).sort((x, y) => x.score - y.score);
  const equivalent = list.find((c) => c.score >= currentScore * 0.98) || list.at(-1);
  const superior = list.filter((c) => c.score >= currentScore * 1.12 && c !== equivalent);
  // Superior: el primer escalón y el tope de la plataforma (sin repetir).
  const picks = [...new Set([superior[0], superior.at(-1)].filter(Boolean))];
  return [
    { tier: 'Equivalente', name: equivalent.name, diff: pct(currentScore, equivalent.score), score: equivalent.score },
    ...picks.map((c) => ({ tier: 'Superior', name: c.name, diff: pct(currentScore, c.score), score: c.score })),
  ];
}

function boardOption(vendor, prefs, segment) {
  const def = modern[vendor];
  const tier = segment === 'enthusiast' ? 'enthusiast' : 'mainstream';
  const branded = prefs.boardBrand && hw.brands.boards[prefs.boardBrand]?.[def.platform]?.[tier];
  return branded || `Placa ${def.boards[tier]}`;
}

function gpuOptions(vendor, current, cpuTarget) {
  const pool = hw.gpuDb.filter((g) => !g.integrated && g.year >= 2022 && hw.gpuVendor(g) === vendor).sort((x, y) => x.score - y.score);
  const equivalent = pool.find((g) => g.score >= current * 0.95);
  const superior = pool.filter((g) => g.score >= current * 1.25 && g.score <= cpuTarget * 1.08);
  const out = [];
  if (equivalent) out.push({ tier: 'Equivalente', name: `${equivalent.name} (${equivalent.vram} GB)`, diff: pct(current, equivalent.score), score: equivalent.score });
  const sup = superior.find((g) => g !== equivalent && g.year >= 2024) || superior.find((g) => g !== equivalent);
  if (sup) out.push({ tier: 'Superior', name: `${sup.name} (${sup.vram} GB)`, diff: pct(current, sup.score), score: sup.score });
  return out;
}

function matchProfile({ profile, prefs, cpuId, chipset, platform, gpu, ram, resFactor }) {
  if (!prefs?.name) return null;
  const found = detectBrands(profile, gpu);
  const rows = [];
  const currentVendor = platform?.vendor || cpuId.family?.vendor || null;
  const needPlatform = !!(prefs.cpuBrand && currentVendor && prefs.cpuBrand !== currentVendor);
  let cpuScoreAfter = cpuId.score;

  // Procesador y plataforma
  if (!prefs.cpuBrand) {
    rows.push({ key: 'cpu', current: cpuId.name, wanted: 'Sin preferencia', status: 'ok', message: 'Tu perfil no exige una marca de procesador.' });
  } else if (!needPlatform) {
    rows.push({ key: 'cpu', current: cpuId.name, wanted: prefs.cpuBrand, status: 'ok', message: `Ya usas un procesador ${prefs.cpuBrand}.` });
  } else {
    const options = cpuOptions(prefs.cpuBrand, cpuId.score);
    const chosen = options.find((o) => o.tier === (BUDGET_TARGET[prefs.budget] === 'equivalent' ? 'Equivalente' : 'Superior')) || options[0];
    cpuScoreAfter = chosen.score;
    rows.push({
      key: 'cpu', current: cpuId.name, wanted: prefs.cpuBrand, status: 'change',
      message: `Tu procesador es ${currentVendor}. Para pasar a ${prefs.cpuBrand} manteniendo o superando tu rendimiento actual:`,
      options,
    });
  }

  // Placa madre
  const boardName = `${profile.board?.manufacturer || ''} ${profile.board?.model || ''}`.trim();
  if (needPlatform) {
    const segment = chipset?.segment;
    rows.push({
      key: 'board', current: boardName, wanted: [prefs.cpuBrand, prefs.boardBrand].filter(Boolean).join(' · '), status: 'change',
      message: `Tu placa${chipset ? ` ${chipset.id}` : ''} sólo admite procesadores ${currentVendor}: hay que cambiarla junto con el procesador.`,
      options: [
        { tier: 'Equivalente', name: boardOption(prefs.cpuBrand, prefs, segment), diff: segment === 'enthusiast' ? 'Gama alta' : 'Gama media' },
        ...(segment !== 'enthusiast' ? [{ tier: 'Superior', name: boardOption(prefs.cpuBrand, prefs, 'enthusiast'), diff: 'Gama alta' }] : []),
      ],
    });
  } else if (prefs.boardBrand && found.board && found.board !== prefs.boardBrand) {
    rows.push({ key: 'board', current: boardName, wanted: prefs.boardBrand, status: 'optional', message: `Tu placa es ${found.board}. No limita tu equipo: cámbiala a ${prefs.boardBrand} sólo si renuevas la plataforma${chipset ? ` (busca una ${prefs.boardBrand} con chipset ${chipset.id} o superior)` : ''}.` });
  } else {
    rows.push({ key: 'board', current: boardName, wanted: prefs.boardBrand || 'Sin preferencia', status: 'ok', message: prefs.boardBrand ? `Ya es ${prefs.boardBrand}.` : 'Tu perfil no exige una marca de placa.' });
  }

  // Tarjeta de video
  const gpuName = gpu?.match?.name || gpu?.name || 'Sin tarjeta dedicada';
  const gpuVendorNow = gpu?.match ? hw.gpuVendor(gpu.match) : null;
  const gpuWanted = [prefs.gpuBrand, prefs.gpuMaker].filter(Boolean).join(' · ') || 'Sin preferencia';
  let gpuScoreAfter = gpu?.score ?? 0;
  if (prefs.gpuBrand && gpu?.score && !gpu.integrated && gpuVendorNow !== prefs.gpuBrand) {
    const options = gpuOptions(prefs.gpuBrand, gpu.score, cpuScoreAfter * resFactor);
    const maker = prefs.gpuMaker && (hw.brands.gpuMakers[prefs.gpuBrand] || []).includes(prefs.gpuMaker) ? ` Elige la versión ${prefs.gpuMaker} (${hw.brands.gpuSeries[prefs.gpuMaker]}).` : '';
    gpuScoreAfter = options.at(-1)?.score ?? gpuScoreAfter;
    rows.push({ key: 'gpu', current: gpuName, wanted: gpuWanted, status: 'change', message: `Tu tarjeta es ${gpuVendorNow || 'de otra marca'}. Opciones ${prefs.gpuBrand} sin cuello de botella con tu procesador:${maker}`, options });
  } else if (prefs.gpuMaker && found.gpuMaker && found.gpuMaker !== prefs.gpuMaker) {
    rows.push({ key: 'gpu', current: `${gpuName} · ${found.gpuMaker}`, wanted: gpuWanted, status: 'optional', message: `El chip ya es el que quieres; la ensambladora es ${found.gpuMaker}. Elige ${prefs.gpuMaker} en tu próxima tarjeta.` });
  } else {
    rows.push({ key: 'gpu', current: `${gpuName}${found.gpuMaker ? ` · ${found.gpuMaker}` : ''}`, wanted: gpuWanted, status: 'ok', message: prefs.gpuBrand || prefs.gpuMaker ? 'Tu tarjeta ya coincide con tu perfil.' : 'Tu perfil no exige una marca de tarjeta.' });
  }

  // Memoria RAM
  const ramName = `${ram.totalGb} GB ${ram.type || ''}${found.ram ? ` · ${found.ram}` : ''}`.trim();
  const ramSeries = prefs.ramBrand ? hw.brands.ram[prefs.ramBrand] : null;
  if (needPlatform && ram.type !== 'DDR5') {
    rows.push({ key: 'ram', current: ramName, wanted: prefs.ramBrand || 'DDR5', status: 'change', message: `La nueva placa usa DDR5 y tu memoria es ${ram.type || 'de otro tipo'}.`, options: [{ tier: 'Equivalente', name: `${Math.max(32, ram.totalGb)} GB DDR5-6000 CL30${ramSeries ? ` (${ramSeries})` : ''}`, diff: '2 módulos' }] });
  } else if (prefs.ramBrand && found.ram && found.ram !== prefs.ramBrand) {
    rows.push({ key: 'ram', current: ramName, wanted: prefs.ramBrand, status: 'optional', message: `${needPlatform ? 'Tu RAM DDR5 sirve en la nueva placa. ' : ''}Si amplías, usa un kit ${ramSeries}.` });
  } else {
    rows.push({ key: 'ram', current: ramName, wanted: prefs.ramBrand || 'Sin preferencia', status: 'ok', message: needPlatform ? 'Tu RAM DDR5 sirve en la nueva placa.' : prefs.ramBrand ? `Ya es ${prefs.ramBrand}.` : 'Tu perfil no exige una marca de RAM.' });
  }

  // Almacenamiento
  const sys = (profile.disks || []).find((d) => d.isSystem);
  if (prefs.storageBrand && found.storage && found.storage !== prefs.storageBrand) {
    rows.push({ key: 'storage', current: sys?.name || '—', wanted: prefs.storageBrand, status: 'optional', message: `Tu SSD es ${found.storage} y funciona bien. Si amplías, elige ${hw.brands.storage[prefs.storageBrand]}.` });
  } else {
    rows.push({ key: 'storage', current: sys?.name || '—', wanted: prefs.storageBrand || 'Sin preferencia', status: 'ok', message: prefs.storageBrand ? `Ya es ${prefs.storageBrand}.` : 'Tu perfil no exige una marca de SSD.' });
  }

  // Fuente de poder (no se puede leer desde Windows)
  const watts = hw.psuWatts(gpuScoreAfter);
  rows.push({
    key: 'psu', current: 'No detectable', wanted: prefs.psuBrand || 'Sin preferencia', status: 'info',
    message: `Windows no informa la fuente instalada. Para ${gpuScoreAfter !== gpu?.score ? 'el equipo con estos cambios' : 'tu equipo'} se recomiendan ≈ ${watts} W 80 Plus Gold${prefs.psuBrand ? ` (${hw.brands.psu[prefs.psuBrand]})` : ''}.`,
  });

  const changes = rows.filter((r) => r.status === 'change');
  return {
    profile: prefs.name,
    found,
    rows,
    required: changes.map((r) => r.key),
    optional: rows.filter((r) => r.status === 'optional').map((r) => r.key),
    summary: changes.length
      ? `Para que tu equipo coincida con tu perfil hay que cambiar: ${changes.map((r) => LABELS[r.key]).join(', ')}.`
      : 'Tu equipo ya coincide con tu perfil en lo esencial.',
  };
}

const LABELS = { cpu: 'procesador', board: 'placa madre', gpu: 'tarjeta de video', ram: 'memoria RAM', storage: 'almacenamiento', psu: 'fuente' };

module.exports = { matchProfile, detectBrands };
