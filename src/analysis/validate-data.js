// Validador de los catálogos de src/data. Devuelve { errors, warnings }:
//  - errors: datos que rompen el análisis (deben corregirse antes de publicar).
//  - warnings: datos dudosos o desactualizados (conviene revisarlos).
const hw = require('./hardware');
// Por defecto se valida el catálogo incluido en el repositorio (no una copia descargada).
const catalog = require('./catalog');
const bundled = catalog.readSet(catalog.BUNDLED_DIR);
const defaults = { gpuData: bundled.gpus, platformData: bundled.platforms, brands: bundled.brands, gpusExtra: bundled.gpusExtra, cpusBlender: bundled.cpusBlender };

const CONF = ['alta', 'media', 'baja'];
const SEGMENTS = ['entry', 'mainstream', 'enthusiast'];
const MAX_AGE_DAYS = 365;

// Igual que hardware.identifyGpu, pero sobre el catálogo que se está validando.
function identifyIn(list, name) {
  const norm = hw.normalizeGpuName(name);
  let best = null;
  for (const g of list) {
    const re = new RegExp(`(^|\\s)${g.id.replace(/\s+/g, '\\s')}(\\s|$)`);
    if (re.test(norm) && (!best || g.id.length > best.id.length)) best = g;
  }
  return best;
}

function checkMeta(name, meta, errors, warnings, now) {
  if (!meta) return errors.push(`${name}: falta el bloque "meta" (versión, fecha y fuentes).`);
  if (!meta.updated || isNaN(new Date(meta.updated))) errors.push(`${name}: "meta.updated" no es una fecha válida.`);
  else {
    const days = (now - new Date(meta.updated)) / 864e5;
    if (days > MAX_AGE_DAYS) warnings.push(`${name}: el catálogo no se revisa hace ${Math.floor(days)} días.`);
  }
  if (!meta.method) warnings.push(`${name}: falta "meta.method" (cómo se obtuvieron los valores).`);
}

// Se pueden pasar catálogos alternativos (las pruebas lo usan para comprobar que detecta errores).
function validate({
  now = new Date(),
  gpuData = defaults.gpuData,
  platformData = defaults.platformData,
  brands = defaults.brands,
  gpusExtra = defaults.gpusExtra,
  cpusBlender = defaults.cpusBlender,
  manifestDir = null, // si se indica, se comprueba que manifest.json coincide con los archivos
} = {}) {
  const errors = [];
  const warnings = [];

  // ---------- gpus.json ----------
  const gm = gpuData.meta;
  checkMeta('gpus.json', gm, errors, warnings, now);
  if (gm && !gm.sources?.[gm.defaults?.src]) errors.push('gpus.json: la fuente por defecto no está definida en meta.sources.');
  const ids = new Set();
  const year = now.getFullYear();
  for (const g of gpuData.gpus) {
    const tag = `GPU «${g.id}»`;
    if (!g.id || g.id !== g.id.toLowerCase().trim() || /\s{2,}/.test(g.id)) errors.push(`${tag}: el id debe estar en minúsculas y sin espacios dobles.`);
    if (ids.has(g.id)) errors.push(`${tag}: id duplicado.`);
    ids.add(g.id);
    if (!g.name) errors.push(`${tag}: falta "name".`);
    if (typeof g.score !== 'number' || g.score <= 0 || g.score > 200) errors.push(`${tag}: "score" debe ser un número entre 0 y 200.`);
    if (!Number.isInteger(g.year) || g.year < 2010 || g.year > year + 1) errors.push(`${tag}: "year" fuera de rango.`);
    if (g.conf && !CONF.includes(g.conf)) errors.push(`${tag}: "conf" debe ser ${CONF.join(', ')}.`);
    if (g.src && !gm.sources?.[g.src]) errors.push(`${tag}: la fuente «${g.src}» no existe en meta.sources.`);
    if (!g.integrated) {
      if (![2, 3, 4, 5].includes(g.pcie)) errors.push(`${tag}: "pcie" debe ser 2, 3, 4 o 5.`);
      if (![4, 8, 16].includes(g.lanes)) errors.push(`${tag}: "lanes" debe ser 4, 8 o 16.`);
      if (typeof g.vram !== 'number' || g.vram <= 0) errors.push(`${tag}: "vram" debe ser un número de GB.`);
    }
    // El nombre oficial debe identificarse como el mismo modelo (detecta ids que nunca coincidirían).
    const found = identifyIn(gpuData.gpus, g.name);
    if (!found || found.id !== g.id) errors.push(`${tag}: el nombre «${g.name}» se identifica como «${found?.id || 'nada'}».`);
  }
  // Orden coherente dentro de cada familia: una versión "SUPER/Ti/XT" no debería rendir menos que la base.
  for (const g of gpuData.gpus) {
    const base = gpuData.gpus.find((b) => b !== g && g.id.startsWith(`${b.id} `) && /\s(super|ti|xt|xtx)$/.test(g.id));
    if (base && g.score < base.score) warnings.push(`GPU «${g.id}» tiene menos índice (${g.score}) que «${base.id}» (${base.score}).`);
  }

  // ---------- platforms.json ----------
  checkMeta('platforms.json', platformData.meta, errors, warnings, now);
  for (const [key, p] of Object.entries(platformData.platforms)) {
    const tag = `Plataforma «${key}»`;
    if (typeof p.ceiling !== 'number' || p.ceiling <= 0) errors.push(`${tag}: "ceiling" debe ser un número positivo.`);
    if (!Array.isArray(p.bestCpus) || !p.bestCpus.length) errors.push(`${tag}: falta "bestCpus".`);
    for (const name of p.bestCpus || []) {
      const cpu = hw.identifyCpu(name);
      if (cpu.estimated) errors.push(`${tag}: el procesador «${name}» no se reconoce (quedaría estimado).`);
      else if (cpu.score > p.ceiling * 1.25) warnings.push(`${tag}: «${name}» (${cpu.score}) supera claramente el techo de la plataforma (${p.ceiling}).`);
    }
  }
  for (const [id, c] of Object.entries(platformData.chipsets)) {
    const tag = `Chipset «${id}»`;
    if (!platformData.platforms[c.platform]) errors.push(`${tag}: la plataforma «${c.platform}» no existe.`);
    if (!SEGMENTS.includes(c.segment)) errors.push(`${tag}: "segment" debe ser ${SEGMENTS.join(', ')}.`);
    if (![2, 3, 4, 5].includes(c.gpuPcie)) errors.push(`${tag}: "gpuPcie" debe ser 2, 3, 4 o 5.`);
    if (hw.identifyChipset(`Placa ${id} Gaming`)?.id !== id) errors.push(`${tag}: no se reconoce dentro de un nombre de placa.`);
  }
  for (const [vendor, m] of Object.entries(platformData.modern || {})) {
    if (!platformData.platforms[m.platform]) errors.push(`Plataforma moderna ${vendor}: «${m.platform}» no existe.`);
    for (const name of m.cpus) if (hw.identifyCpu(name).estimated) errors.push(`Plataforma moderna ${vendor}: «${name}» no se reconoce.`);
  }

  // ---------- brands.json ----------
  checkMeta('brands.json', brands.meta, errors, warnings, now);
  for (const [hex, name] of Object.entries(brands.pciVendors)) if (!/^[0-9A-F]{4}$/.test(hex)) errors.push(`pciVendors: «${hex}» (${name}) debe tener 4 dígitos hexadecimales en mayúsculas.`);
  for (const [vendor, makers] of Object.entries(brands.gpuMakers)) {
    if (!brands.gpu.includes(vendor)) errors.push(`gpuMakers: «${vendor}» no está en la lista de marcas de GPU.`);
    for (const m of makers) if (!brands.gpuSeries[m]) warnings.push(`gpuSeries: falta la serie de «${m}».`);
  }
  for (const [brand, plats] of Object.entries(brands.boards)) {
    for (const key of Object.values(platformData.modern || {}).map((m) => m.platform)) {
      if (!plats[key]?.mainstream || !plats[key]?.enthusiast) errors.push(`boards «${brand}»: faltan modelos de gama media y alta para ${key}.`);
    }
  }

  // ---------- Catálogos generados desde fuentes públicas ----------
  if (gpusExtra?.gpus?.length) {
    const m = gpusExtra.meta || {};
    if (m.sources?.blender?.license !== 'CC0 1.0') errors.push('gpus-extra.json: falta la licencia de Blender Open Data (CC0 1.0).');
    if (m.sources?.openGpuDb?.license !== 'Apache-2.0') errors.push('gpus-extra.json: falta la licencia de open-gpu-db (Apache-2.0).');
    if (!m.generated || isNaN(new Date(m.generated))) errors.push('gpus-extra.json: "meta.generated" no es una fecha válida.');
    else if ((now - new Date(m.generated)) / 864e5 > 120) warnings.push(`gpus-extra.json: generado hace más de 120 días (${m.generated}); la tarea mensual podría estar fallando.`);
    if (m.calibration?.medianError > 15) warnings.push(`gpus-extra.json: el error mediano de la estimación es ${m.calibration.medianError} %.`);
    const keys = new Set();
    for (const g of gpusExtra.gpus) {
      const tag = `GPU ampliada «${g.key}»`;
      if (!g.key || keys.has(g.key)) errors.push(`${tag}: clave vacía o duplicada.`);
      keys.add(g.key);
      if (g.blender != null && !(g.blender > 0 && g.blenderN >= 15)) errors.push(`${tag}: rendimiento de Blender inválido.`);
      if (g.est != null && !(g.est > 0 && g.est < 250)) errors.push(`${tag}: índice estimado fuera de rango.`);
      if (g.pcie != null && ![1, 2, 3, 4, 5].includes(g.pcie)) errors.push(`${tag}: "pcie" inválido.`);
      if (g.vram != null && !(g.vram >= 0 && g.vram <= 256)) errors.push(`${tag}: "vram" fuera de rango.`);
    }
  }
  if (cpusBlender?.cpus?.length) {
    const keys = new Set();
    for (const c of cpusBlender.cpus) {
      if (!c.key || keys.has(c.key)) errors.push(`CPU medida «${c.key}»: clave vacía o duplicada.`);
      keys.add(c.key);
      if (!(c.blender > 0)) errors.push(`CPU medida «${c.key}»: rendimiento inválido.`);
    }
  }

  // ---------- Manifiesto (lo que la app usa para descargar y verificar el catálogo) ----------
  if (manifestDir) {
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const manifest = catalog.readManifest(manifestDir);
    if (!manifest) errors.push('manifest.json: no existe. Ejecuta npm run build-manifest.');
    else {
      for (const file of Object.values(catalog.FILES)) {
        const full = path.join(manifestDir, file);
        if (!fs.existsSync(full)) continue;
        const sha = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        if (manifest.files?.[file]?.sha256 !== sha) errors.push(`manifest.json: la huella de ${file} no coincide. Ejecuta npm run build-manifest.`);
      }
    }
  }

  return { errors, warnings };
}

module.exports = { validate };
