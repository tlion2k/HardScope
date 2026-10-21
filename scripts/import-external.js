// Importa datos públicos y genera los catálogos livianos de src/data/generated:
//  - Blender Open Data (CC0): rendimiento medido en render por la comunidad (GPU y CPU).
//  - open-gpu-db (Apache-2.0): especificaciones de GPUs (VRAM, PCIe, TDP, año).
// El índice de juegos de las GPUs que no están en gpus.json se estima desde Blender,
// calibrado contra las GPUs que sí están; el error de esa estimación se mide y se guarda.
//
// Uso (lo ejecuta la tarea programada de GitHub):
//   unzip -p opendata-latest.zip '*.jsonl' | node scripts/import-external.js --open-gpu-db catalog.json
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const hw = require('../src/analysis/hardware');

const SCENES = ['monster', 'junkshop', 'classroom'];
const GPU_BACKENDS = ['OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'OPENCL']; // METAL se omite: sólo Apple
const MIN_RESULTS = 5; // resultados mínimos por escena para aceptar un dispositivo
const DATACENTER = /\b(instinct|tesla|h100|h200|a100|a800|h800|b100|b200|b300|gb200|gb300|rubin|mi\d{2,3}x?)\b/i;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const OUT = arg('--out') || path.join(__dirname, '..', 'src', 'data', 'generated');
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// Las mismas claves que usa la app para buscar en este catálogo.
const { gpuKey, cpuKey } = hw;

// ---------- Blender Open Data (JSONL por stdin) ----------
async function readBlender(input) {
  // agg[kind][key][version][scene] = [samples_per_minute...]
  const agg = { gpu: new Map(), cpu: new Map() };
  const names = { gpu: new Map(), cpu: new Map() };
  const stats = { lines: 0, used: 0, newest: '' };
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    stats.lines++;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.created_at > stats.newest) stats.newest = rec.created_at;
    for (const d of Array.isArray(rec.data) ? rec.data : rec.data ? [rec.data] : []) {
      const spm = d.stats?.samples_per_minute;
      const scene = d.scene?.label;
      const type = d.device_info?.device_type;
      if (!(spm > 0) || !SCENES.includes(scene) || !type) continue;
      const version = String(d.blender_version?.version || '').split('.').slice(0, 2).join('.');
      const devices = [...new Set((d.device_info.compute_devices || []).map((c) => c.name))];
      if (devices.length !== 1) continue; // varias GPU a la vez: no se puede atribuir el resultado
      const kind = type === 'CPU' ? 'cpu' : GPU_BACKENDS.includes(type) ? 'gpu' : null;
      if (!kind) continue;
      const key = kind === 'gpu' ? `${gpuKey(devices[0])}|${type}` : cpuKey(devices[0]);
      if (!key || key.startsWith('|')) continue;
      const byVersion = agg[kind].get(key) || new Map();
      const scenes = byVersion.get(version) || {};
      (scenes[scene] ||= []).push(spm);
      byVersion.set(version, scenes);
      agg[kind].set(key, byVersion);
      const n = names[kind].get(key) || new Map();
      n.set(devices[0], (n.get(devices[0]) || 0) + 1);
      names[kind].set(key, n);
      stats.used++;
    }
  }
  return { agg, names, stats };
}

// Puntaje por versión = suma de las medianas de las 3 escenas (como el puntaje oficial de Blender).
function versionScores(byVersion) {
  const out = new Map();
  for (const [version, scenes] of byVersion) {
    if (SCENES.every((s) => (scenes[s] || []).length >= MIN_RESULTS)) {
      out.set(version, { score: SCENES.reduce((t, s) => t + median(scenes[s]), 0), n: SCENES.reduce((t, s) => t + scenes[s].length, 0) });
    }
  }
  return out;
}

// Lleva todos los puntajes a una versión de referencia (Cycles cambia entre versiones).
function normalizeVersions(devices) {
  const counts = new Map();
  for (const vs of devices.values()) for (const [v, x] of vs) counts.set(v, (counts.get(v) || 0) + x.n);
  const ref = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const factor = new Map([[ref, 1]]);
  for (const v of counts.keys()) {
    if (v === ref) continue;
    const ratios = [];
    for (const vs of devices.values()) if (vs.has(ref) && vs.has(v)) ratios.push(vs.get(ref).score / vs.get(v).score);
    if (ratios.length >= 5) factor.set(v, median(ratios));
  }
  const result = new Map();
  for (const [key, vs] of devices) {
    let best = null;
    for (const [v, x] of vs) {
      if (!factor.has(v)) continue;
      const cand = { score: x.score * factor.get(v), n: x.n, version: v };
      if (!best || v === ref || (best.version !== ref && x.n > best.n)) best = cand;
      if (v === ref) break;
    }
    if (best) result.set(key, best);
  }
  return { ref, factor, result };
}

function topName(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------- open-gpu-db ----------
function readOpenGpuDb(file) {
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = new Map();
  for (const g of db.gpus || []) {
    if (!['nvidia', 'amd', 'intel'].includes(g.vendor)) continue;
    const year = g.release_date ? +g.release_date.slice(0, 4) : null;
    if (year && year < 2012) continue;
    // Aceleradores de centro de datos: no van en un PC.
    if (g.device_type === 'accelerator' || (g.memory?.capacity_gb ?? 0) > 128 || DATACENTER.test(g.name)) continue;
    const bus = String(g.specs?.bus_interface || '').match(/PCIe\s*(\d)\.0\s*x(\d+)/i);
    const key = gpuKey(g.name);
    if (!key || out.has(key)) continue;
    out.set(key, {
      name: g.name,
      vendor: { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' }[g.vendor],
      integrated: g.device_type === 'integrated',
      year,
      vram: g.memory?.capacity_gb ?? null,
      pcie: bus ? +bus[1] : null,
      lanes: bus ? +bus[2] : null,
      tdp: g.specs?.tdp_w ?? null,
      generation: g.generation || null,
    });
  }
  return { version: db.catalog_version, schema: db.schema_version, gpus: out };
}

// ---------- Programa principal ----------
(async () => {
  const ogFile = arg('--open-gpu-db');
  const og = ogFile ? readOpenGpuDb(ogFile) : { gpus: new Map() };
  const { agg, names, stats } = await readBlender(process.stdin);

  // GPU: mejor backend por modelo (OptiX suele superar a CUDA en NVIDIA).
  const gpuVersions = new Map();
  for (const [k, byVersion] of agg.gpu) gpuVersions.set(k, versionScores(byVersion));
  const gpuNorm = normalizeVersions(gpuVersions);
  const gpuBest = new Map();
  for (const [k, x] of gpuNorm.result) {
    const [key, backend] = k.split('|');
    // OptiX sin núcleos RT (GTX y anteriores) corre por software: no representa a la tarjeta.
    if (backend === 'OPTIX' && !/\brtx\b/.test(key)) continue;
    const cur = gpuBest.get(key);
    if (!cur || x.score > cur.score) gpuBest.set(key, { ...x, backend, name: topName(names.gpu.get(k)) });
  }

  const cpuVersions = new Map();
  for (const [k, byVersion] of agg.cpu) cpuVersions.set(k, versionScores(byVersion));
  const cpuNorm = normalizeVersions(cpuVersions);

  // Calibración: índice de juegos curado / puntaje de Blender, por marca y backend de Blender
  // (las GPU sin núcleos RT usan CUDA en vez de OptiX y rinden distinto en render).
  // La relación render/juegos cambia con la arquitectura: se calibra por generación (open-gpu-db)
  // cuando hay al menos 3 GPUs de referencia y, si no, por marca + backend.
  const curated = hw.gpuDb.filter((g) => !g.integrated && g.year >= 2016 && gpuBest.has(g.id));
  const groupsOf = (vendor, backend, generation) => [generation ? `${vendor}|${backend}|${generation}` : null, `${vendor}|${backend}`].filter(Boolean);
  const samples = curated.map((g) => {
    const b = gpuBest.get(g.id);
    return { id: g.id, score: g.score, blender: b.score, groups: groupsOf(hw.gpuVendor(g), b.backend, og.gpus.get(g.id)?.generation) };
  });
  const buildFactors = (list) => {
    const byGroup = {};
    for (const s of list) for (const k of s.groups) (byGroup[k] ||= []).push(s.score / s.blender);
    return Object.fromEntries(Object.entries(byGroup).filter(([, a]) => a.length >= 3).map(([k, a]) => [k, median(a)]));
  };
  const pickFactor = (f, groups) => groups.map((k) => f[k]).find((x) => x != null) ?? null;
  const factors = buildFactors(samples);
  // Error de la estimación, dejando cada GPU fuera de su propia calibración.
  const errors = [];
  for (const s of samples) {
    const f = pickFactor(buildFactors(samples.filter((x) => x !== s)), s.groups);
    if (f) errors.push(Math.abs((s.blender * f) / s.score - 1));
  }

  // Unión: todas las GPUs conocidas por alguna fuente.
  const keys = new Set([...og.gpus.keys(), ...gpuBest.keys()]);
  const gpus = [];
  for (const key of [...keys].sort()) {
    const spec = og.gpus.get(key) || {};
    const b = gpuBest.get(key);
    if (!b && !spec.name) continue;
    if (!b && spec.integrated) continue;
    const vendor = spec.vendor || (/^(rtx|gtx|gt|quadro|tesla)\b/.test(key) ? 'NVIDIA' : /^(rx|radeon|instinct|firepro)\b/.test(key) ? 'AMD' : /^arc\b/.test(key) ? 'Intel' : null);
    const factor = vendor && b ? pickFactor(factors, groupsOf(vendor, b.backend, spec.generation)) : null;
    const laptop = /\blaptop\b/.test(key);
    gpus.push({
      key,
      name: spec.name || b.name,
      vendor,
      year: spec.year ?? null,
      vram: spec.vram ?? null,
      pcie: spec.pcie ?? null,
      lanes: spec.lanes ?? null,
      tdp: laptop ? null : spec.tdp ?? null, // el TDP de portátil depende del modelo de equipo
      blender: b ? round(b.score, 0) : null,
      blenderN: b ? b.n : null,
      backend: b ? b.backend : null,
      // El factor viene de GPUs de escritorio: en portátiles el límite de potencia cambia el resultado,
      // pero el puntaje medido de Blender ya refleja ese portátil.
      est: b && factor ? round(b.score * factor, 1) : null,
      laptop: laptop || undefined,
    });
  }

  const cpus = [];
  for (const [key, x] of cpuNorm.result) cpus.push({ key, name: topName(names.cpu.get(key)), blender: round(x.score, 1), blenderN: x.n });
  cpus.sort((a, b) => a.key.localeCompare(b.key));

  const today = new Date().toISOString().slice(0, 10);
  const meta = {
    schema: 1,
    generated: today,
    sources: {
      blender: {
        name: 'Blender Open Data',
        url: 'https://opendata.blender.org/',
        license: 'CC0 1.0',
        snapshot: stats.newest.slice(0, 10),
        results: stats.used,
        method: `Suma de las medianas de samples/min en ${SCENES.join(', ')}; mínimo ${MIN_RESULTS} resultados por escena; normalizado a Blender ${gpuNorm.ref} (GPU) y ${cpuNorm.ref} (CPU).`,
      },
      openGpuDb: { name: 'open-gpu-db', url: 'https://github.com/onepunk/open-gpu-db', license: 'Apache-2.0', catalogVersion: og.version || null },
    },
  };
  fs.mkdirSync(OUT, { recursive: true });
  const gpuOut = {
    meta: {
      ...meta,
      calibration: {
        method: 'índice estimado = puntaje de Blender × factor de su generación (o, si hay menos de 3 GPUs de referencia, de su marca y backend OptiX/CUDA/HIP); factor = mediana(índice curado / puntaje de Blender) en GPUs de escritorio desde 2016 presentes en gpus.json. Error medido dejando cada GPU fuera de su propia calibración.',
        factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, +v.toFixed(5)])),
        samples: curated.length,
        medianError: errors.length ? round(median(errors) * 100, 1) : null,
        p90Error: errors.length ? round([...errors].sort((a, b) => a - b)[Math.floor(errors.length * 0.9)] * 100, 1) : null,
      },
    },
    gpus,
  };
  fs.writeFileSync(path.join(OUT, 'gpus-extra.json'), `${JSON.stringify(gpuOut.meta ? { meta: gpuOut.meta } : {}, null, 2).slice(0, -2)},\n  "gpus": [\n${gpus.map((g) => `    ${JSON.stringify(g)}`).join(',\n')}\n  ]\n}\n`);
  fs.writeFileSync(path.join(OUT, 'cpus-blender.json'), `${JSON.stringify({ meta }, null, 2).slice(0, -2)},\n  "cpus": [\n${cpus.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`);

  const withBlender = gpus.filter((g) => g.blender).length;
  console.log(`Blender: ${stats.lines} líneas, ${stats.used} resultados usados (hasta ${meta.sources.blender.snapshot}); versión de referencia GPU ${gpuNorm.ref}, CPU ${cpuNorm.ref}.`);
  console.log(`GPUs: ${gpus.length} en total (${withBlender} con rendimiento medido, ${og.gpus.size} con especificaciones).`);
  console.log(`CPUs con rendimiento medido: ${cpus.length}.`);
  console.log(`Calibración con ${curated.length} GPUs curadas: factores ${JSON.stringify(gpuOut.meta.calibration.factors)}; error mediano ${gpuOut.meta.calibration.medianError} %, p90 ${gpuOut.meta.calibration.p90Error} %.`);
})();
