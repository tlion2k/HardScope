// Identificación de componentes contra la base de datos local y cálculo de puntajes.
// Todo en la misma escala: "puntaje de GPU" (RTX 4090 = 100 a 1440p).
const catalog = require('./catalog');
const gpuData = catalog.gpus;
const platformData = catalog.platforms;
const gpuDb = gpuData.gpus;
const { platforms, chipsets } = platformData;
// Catálogo ampliado generado desde fuentes públicas (scripts/import-external.js).
const extraByKey = new Map(catalog.gpusExtra.gpus.map((g) => [g.key, g]));
const cpuBlenderByKey = new Map(catalog.cpusBlender.cpus.map((c) => [c.key, c]));
// Versión y fecha de cada catálogo, para mostrar de dónde sale cada índice.
const dataInfo = {
  gpus: { version: gpuData.meta.version, updated: gpuData.meta.updated, count: gpuDb.length, source: gpuData.meta.sources[gpuData.meta.defaults.src] },
  platforms: { version: platformData.meta.version, updated: platformData.meta.updated, count: Object.keys(chipsets).length },
  extra: { count: extraByKey.size, measured: catalog.gpusExtra.gpus.filter((g) => g.blender).length, cpus: cpuBlenderByKey.size, ...catalog.gpusExtra.meta },
  catalog: { version: catalog.manifest?.version ?? null, origin: catalog.origin },
};

const PCIE_LANE_GBPS = { 1: 0.25, 2: 0.5, 3: 0.985, 4: 1.969, 5: 3.938 };

function normalizeGpuName(name = '') {
  return name
    .toLowerCase()
    .replace(/\(r\)|\(tm\)|®|™/g, ' ')
    .replace(/\b(nvidia|geforce|amd|ati|intel|corporation)\b|radeon(?=\s+rx)/g, ' ')
    .replace(/\b(laptop gpu|mobile|max-q)\b/g, ' laptop ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave común para cruzar nombres entre fuentes ("GeForce RTX 5060 Ti 16 GB" -> "rtx 5060 ti").
function gpuKey(name) {
  return normalizeGpuName(name)
    .replace(/\b\d+\s?gb\b/g, ' ')
    .replace(/\b(founders edition|oem|series)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cpuKey(name) {
  return String(name)
    .replace(/\(r\)|\(tm\)|®|™/gi, ' ')
    .replace(/\b\d+-core processor\b|\bprocessor\b|\bcpu\b|@\s*[\d.]+\s*ghz/gi, ' ')
    .replace(/\b(intel|amd)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const measured = (e) => (e?.blender ? { score: e.blender, n: e.blenderN, backend: e.backend } : null);

function identifyGpu(name) {
  const norm = normalizeGpuName(name);
  let best = null;
  for (const g of gpuDb) {
    const re = new RegExp(`(^|\\s)${g.id.replace(/\s+/g, '\\s')}(\\s|$)`);
    if (re.test(norm) && (!best || g.id.length > best.id.length)) best = g;
  }
  const laptop = /\blaptop\b/.test(norm);
  if (best) {
    const desk = extraByKey.get(best.id);
    const mobile = laptop ? extraByKey.get(`${best.id} laptop`) : null;
    // En portátiles se usa la relación medida en Blender (portátil / escritorio) si existe;
    // si no, la regla general de 0,8.
    const ratio = mobile?.blender && desk?.blender ? Math.min(1.1, Math.max(0.4, mobile.blender / desk.blender)) : null;
    const score = laptop ? +(best.score * (ratio ?? 0.8)).toFixed(1) : best.score;
    return {
      ...best,
      conf: best.conf || gpuData.meta.defaults.conf,
      laptop,
      laptopRatio: laptop ? { value: +(ratio ?? 0.8).toFixed(2), source: ratio ? 'blender' : 'regla general' } : null,
      score,
      tdp: laptop ? null : desk?.tdp ?? null,
      blender: measured(laptop ? mobile : desk),
      origin: 'curated',
    };
  }
  // No está en el catálogo curado: se busca en el catálogo ampliado (open-gpu-db + Blender).
  const ext = extraByKey.get(gpuKey(name));
  if (!ext) return null;
  return {
    id: ext.key,
    name: ext.name,
    score: ext.est ?? null,
    pcie: ext.pcie,
    lanes: ext.lanes,
    vram: ext.vram,
    year: ext.year,
    tdp: ext.tdp,
    integrated: false,
    conf: 'baja',
    laptop,
    blender: measured(ext),
    vendor: ext.vendor,
    origin: ext.est != null ? 'estimated' : 'specs',
  };
}

function identifyChipset(boardModel = '') {
  const model = boardModel.toUpperCase();
  const keys = Object.keys(chipsets).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    // El chipset debe aparecer como token: "B550M", "ROG STRIX Z790-E", "PRIME A320M-K"
    const re = new RegExp(`(^|[^A-Z0-9])${key}(?![0-9])`);
    if (re.test(model)) {
      const c = chipsets[key];
      return { id: key, ...c, platformInfo: platforms[c.platform] };
    }
  }
  return null;
}

// --- CPU ---------------------------------------------------------------
// Base = puntaje de alimentación para un modelo de gama media (i5 / Ryzen 5) de esa generación.
const INTEL_GEN_BASE = { 2: 14, 3: 16, 4: 20, 5: 21, 6: 25, 7: 28, 8: 35, 9: 38, 10: 45, 11: 52, 12: 75, 13: 92, 14: 95 };
const AMD_SERIES_BASE = { 1: 22, 2: 28, 3: 45, 4: 45, 5: 65, 7: 95, 8: 75, 9: 105 };
const INTEL_TIER = { 3: 0.8, 5: 1.0, 7: 1.1, 9: 1.15 };
const AMD_TIER = { 3: 0.8, 5: 1.0, 7: 1.08, 9: 1.12 };

function identifyCpu(brand = '', cores = 0, threads = 0, ghz = 0) {
  const name = brand.replace(/\(r\)|\(tm\)|®|™/gi, '').replace(/\s+/g, ' ').trim();
  let m;
  let family = null;
  let score = null;
  let gen = null;

  if ((m = name.match(/Core\s*(?:\(TM\)\s*)?i([3579])[- ](\d{4,5})([A-Z]{0,3})/i))) {
    const tier = +m[1];
    const num = m[2];
    gen = num.length === 5 ? +num.slice(0, 2) : +num[0];
    const suffix = m[3].toUpperCase();
    score = (INTEL_GEN_BASE[gen] ?? 20) * (INTEL_TIER[tier] ?? 1);
    if (tier === 3 && gen < 8) score *= 0.8; // i3 de 2 núcleos
    if (suffix.includes('K')) score *= 1.05;
    if (/^(U|Y)/.test(suffix)) score *= 0.6;
    else if (/^H/.test(suffix)) score *= 0.85;
    family = { vendor: 'Intel', line: `Core i${tier}`, gen, socketHint: intelSocketForGen(gen) };
  } else if ((m = name.match(/Core\s*Ultra\s*([579])\s*(\d)(\d{2})([A-Z]{0,2})/i))) {
    const tier = +m[1];
    const series = +m[2];
    const suffix = m[4].toUpperCase();
    score = (series === 2 && /K|F/.test(suffix) ? 92 : series === 2 ? 88 : 70) * (INTEL_TIER[tier] ?? 1);
    if (/^(U|V)/.test(suffix)) score *= 0.6;
    else if (/^H/.test(suffix)) score *= 0.85;
    gen = series === 2 && !/H|U|V/.test(suffix) ? 'Ultra 200S' : `Ultra ${series}00`;
    family = { vendor: 'Intel', line: `Core Ultra ${tier}`, gen, socketHint: series === 2 && !/H|U|V/.test(suffix) ? 'LGA1851' : null };
  } else if ((m = name.match(/Ryzen\s*(\d)\s*(?:PRO\s*)?(\d)(\d{3})([A-Z0-9]{0,4})/i))) {
    const tier = +m[1];
    const series = +m[2];
    const suffix = m[4].toUpperCase();
    gen = series;
    score = (AMD_SERIES_BASE[series] ?? 30) * (AMD_TIER[tier] ?? 1);
    if (suffix.includes('X3D')) score = series === 5 ? 85 : series === 7 ? 125 : series === 9 ? 140 : score * 1.25;
    else if (suffix.startsWith('G') && series === 5) score = 55 * (AMD_TIER[tier] ?? 1);
    if (/^(U|HS|H|HX)/.test(suffix)) score *= /HX/.test(suffix) ? 0.95 : /^U/.test(suffix) ? 0.6 : 0.85;
    family = { vendor: 'AMD', line: `Ryzen ${tier}`, gen: `${series}000`, socketHint: series >= 7 && series !== 8 ? 'AM5' : series === 8 && /G/.test(suffix) ? 'AM5' : 'AM4' };
  } else if (/FX-\d{4}/i.test(name)) {
    score = 10;
    family = { vendor: 'AMD', line: 'FX', gen: 'FX', socketHint: 'AM3' };
  }

  let estimated = false;
  if (score == null) {
    // Respaldo genérico: núcleos y frecuencia.
    estimated = true;
    const c = Math.max(1, cores);
    score = Math.min(110, Math.max(5, ghz * 8 * Math.min(c, 8) ** 0.55 * (threads > cores ? 1.1 : 1)));
  }
  return { name, family, score: +score.toFixed(1), estimated, blender: cpuBlender(name) };
}

function intelSocketForGen(gen) {
  if (gen === 2 || gen === 3) return 'LGA1155';
  if (gen === 4 || gen === 5) return 'LGA1150';
  if (gen === 6 || gen === 7) return 'LGA1151';
  if (gen === 8 || gen === 9) return 'LGA1151v2';
  if (gen === 10) return 'LGA1200';
  if (gen === 11) return 'LGA1200r';
  if (gen >= 12 && gen <= 14) return 'LGA1700';
  return null;
}

// --- RAM ---------------------------------------------------------------
// Velocidad nominal (XMP/EXPO) a partir del número de parte del módulo.
function ratedSpeedFromPart(part = '') {
  const p = part.toUpperCase().replace(/\s+/g, '');
  const patterns = [
    /(\d{4})C\d{2}/, // G.Skill F4-3200C16, ADATA AX5U5200C38, Corsair ...3200C16
    /KF\d(\d{2})C/, // Kingston Fury KF432C16 -> 3200, KF560C40 -> 6000
    /DDR[345]-?(\d{4})/,
    /-(\d{4})-/,
  ];
  for (const re of patterns) {
    const m = p.match(re);
    if (!m) continue;
    let v = +m[1];
    if (re === patterns[1]) v = +m[1] * 100;
    if (v >= 1333 && v <= 9600) return v;
  }
  return null;
}

const MEM_TYPE = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5', 35: 'LPDDR5' };

function pcieBandwidth(gen, lanes) {
  return (PCIE_LANE_GBPS[gen] ?? 0) * lanes;
}

// Rendimiento en render de CPU medido por la comunidad (Blender Open Data), si existe.
function cpuBlender(name) {
  const e = cpuBlenderByKey.get(cpuKey(name));
  return e ? { score: e.blender, n: e.blenderN } : null;
}

function gpuVendor(g) {
  if (g.vendor) return g.vendor;
  if (/^(rtx|gtx|gt)\s/.test(g.id)) return 'NVIDIA';
  if (/^(rx|radeon)\s/.test(g.id)) return 'AMD';
  if (/^(arc|iris|uhd|hd)\s/.test(g.id)) return 'Intel';
  return null;
}

// Potencia de fuente aproximada recomendada para un equipo con esa GPU.
function psuWatts(score) {
  if (score >= 110) return 1000;
  if (score >= 80) return 850;
  if (score >= 65) return 750;
  if (score >= 45) return 650;
  if (score >= 28) return 550;
  return 450;
}

// GPUs sugeridas para un rango de puntaje, preferentemente modernas (opcionalmente de una marca).
function suggestGpus(minScore, maxScore, limit = 4, vendor = null) {
  return gpuDb
    .filter((g) => !g.integrated && g.score >= minScore && g.score <= maxScore && g.year >= 2022 && (!vendor || gpuVendor(g) === vendor))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((g) => g.name);
}

module.exports = {
  gpuDb,
  platforms,
  chipsets,
  normalizeGpuName,
  gpuKey,
  cpuKey,
  extraByKey,
  catalog,
  identifyGpu,
  identifyChipset,
  identifyCpu,
  intelSocketForGen,
  ratedSpeedFromPart,
  pcieBandwidth,
  suggestGpus,
  gpuVendor,
  psuWatts,
  brands: catalog.brands,
  dataInfo,
  gpuMeta: gpuData.meta,
  platformMeta: platformData.meta,
  MEM_TYPE,
};
