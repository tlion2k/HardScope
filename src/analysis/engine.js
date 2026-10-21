// Motor de diagnóstico: recibe el perfil de hardware recolectado y devuelve
// puntajes, comparaciones (placa vs GPU, CPU vs GPU, PCIe) y hallazgos con severidad.
const hw = require('./hardware');
const { planUpgrades, normalizePrefs } = require('./upgrade');

const SEVERITY_WEIGHT = { critical: 18, warning: 8, tip: 2, ok: 0 };
const RES_FACTOR = { '1080p': 0.8, '1440p': 1.0, '4k': 1.4 };
const RAM_TARGETS = {
  gaming: { critical: 8, warning: 16, tip: 32 },
  creation: { critical: 16, warning: 32, tip: 64 },
  office: { critical: 4, warning: 8, tip: 16 },
};
const POWER_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a';

const GB = 1024 ** 3;
const round = (n, d = 0) => +(+n).toFixed(d);

function analyze(profile, settings = {}) {
  const usage = settings.usage || 'gaming';
  const resolution = settings.resolution || '1440p';
  const resFactor = RES_FACTOR[resolution] ?? 1;
  const prefs = normalizePrefs(settings.prefs);
  // Sugerencias de GPU ancladas a la marca preferida (si no hay de esa marca, genéricas).
  const suggest = (min, max, limit = 4) => (prefs.gpuBrand && hw.suggestGpus(min, max, limit, prefs.gpuBrand).length ? hw.suggestGpus(min, max, limit, prefs.gpuBrand) : hw.suggestGpus(min, max, limit));
  const findings = [];
  const add = (f) => findings.push(f);

  // ---------- Identificación ----------
  const cpuId = hw.identifyCpu(profile.cpu?.brand, profile.cpu?.physicalCores, profile.cpu?.cores, profile.cpu?.speedMax || profile.cpu?.speed);
  const chipset = hw.identifyChipset(`${profile.board?.model || ''} ${profile.board?.version || ''}`);
  let platformKey = chipset?.platform || cpuId.family?.socketHint || null;
  if (platformKey === 'AM4') platformKey = 'AM4b';
  const platform = platformKey ? hw.platforms[platformKey] : null;

  const gpus = (profile.gpus || []).map((g) => {
    const match = hw.identifyGpu(g.name);
    const vramGb = g.vram ? round(g.vram / 1024, 1) : match?.vram ?? 0;
    const integrated = match ? !!match.integrated : vramGb < 1.5 && /intel|radeon\(tm\) graphics|vega/i.test(g.name);
    return { ...g, match, vramGb: match && !match.integrated ? Math.max(vramGb, match.vram) : vramGb, integrated, score: match?.score ?? null };
  });
  const discrete = gpus.filter((g) => !g.integrated).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.vramGb - a.vramGb);
  const gpu = discrete[0] || gpus.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] || null;

  const cpuEff = round(cpuId.score * resFactor, 1);
  const ceiling = platform ? round(platform.ceiling * resFactor, 1) : null;
  const gpuScore = gpu?.score ?? null;

  // ---------- Placa vs tarjeta de video ----------
  const boardVsGpu = { verdict: 'unknown', ratio: null, ceiling, gpuScore };
  if (gpu && gpuScore != null && ceiling) {
    const ratio = gpuScore / ceiling;
    boardVsGpu.ratio = round(ratio, 2);
    const boardLabel = chipset ? `${chipset.id} (${platform.socket})` : platform.socket;
    const modern = modernPlatformAdvice(prefs);
    if (gpu.integrated) {
      boardVsGpu.verdict = 'board';
    } else if (ratio > 1.5) {
      boardVsGpu.verdict = 'gpu';
      add({
        id: 'board-limits-gpu', severity: 'critical', component: 'board',
        title: 'La placa no aprovecha todo el rendimiento de tu tarjeta de video',
        detail: `Tu ${gpu.match.name} (puntaje ${gpuScore}) supera ampliamente lo que la plataforma ${boardLabel} puede alimentar (techo ≈ ${ceiling} a ${resolution}), incluso con su mejor procesador (${platform.bestCpus.join(' / ')}). Una parte importante del rendimiento de la GPU se pierde.`,
        action: `Cambia de plataforma: ${modern}. Así la tarjeta rendirá al 100%.`,
      });
    } else if (ratio > 1.1) {
      boardVsGpu.verdict = 'gpu';
      add({
        id: 'board-limits-gpu', severity: 'warning', component: 'board',
        title: 'La tarjeta de video es superior a la placa',
        detail: `La plataforma ${boardLabel} queda algo corta para tu ${gpu.match.name}: el techo estimado es ${ceiling} y la GPU rinde ${gpuScore}. Perderás algo de rendimiento, sobre todo en juegos que dependen del procesador.`,
        action: platform.eol
          ? `Sube al mejor CPU compatible (${platform.bestCpus.at(-1)}) o, a mediano plazo, cambia a ${modern}.`
          : `Sube al mejor CPU compatible con tu placa: ${platform.bestCpus.join(' / ')}.`,
      });
    } else if (ratio < 0.6 && usage !== 'office') {
      boardVsGpu.verdict = 'board';
      const cap = Math.min(ceiling, cpuEff);
      const options = suggest(Math.max(gpuScore * 1.4, cap * 0.55), cap * 1.0);
      add({
        id: 'board-superior', severity: gpuScore < 15 || ratio < 0.3 ? 'warning' : 'tip', component: 'gpu',
        title: 'Tu placa es superior a tu tarjeta de video',
        detail: `La placa ${boardLabel}${chipset ? ` con slot PCIe ${chipset.gpuPcie}.0` : ''} puede soportar tarjetas mucho más potentes (techo ≈ ${ceiling}) que tu ${gpu.match.name} (${gpuScore}). La GPU es el componente que frena el equipo.`,
        action: options.length
          ? `Puedes subir a: ${options.join(', ')}${cap < ceiling ? ` (limitado por tu CPU actual a ≈ ${cap} puntos)` : ''}.`
          : 'Puedes instalar una tarjeta de gama superior sin cambiar la placa.',
      });
    } else {
      boardVsGpu.verdict = 'balanced';
      add({
        id: 'board-gpu-balanced', severity: 'ok', component: 'board',
        title: 'Placa y tarjeta de video equilibradas',
        detail: `La plataforma ${boardLabel} (techo ≈ ${ceiling}) aprovecha bien tu ${gpu.match.name} (${gpuScore}).`,
      });
    }
  } else if (gpu && !gpu.match) {
    add({
      id: 'gpu-unknown', severity: 'tip', component: 'gpu',
      title: 'Modelo de tarjeta de video no reconocido',
      detail: `"${gpu.name}" no está en la base de datos, por lo que no se pudo comparar con la placa.`,
      action: 'Agrega el modelo en src/data/gpus.json o actualiza HardScope a la última versión.',
    });
  } else if (!platform) {
    add({
      id: 'board-unknown', severity: 'tip', component: 'board',
      title: 'Chipset de la placa no reconocido',
      detail: `No se pudo identificar el chipset de "${profile.board?.manufacturer || ''} ${profile.board?.model || ''}" (común en equipos de marca u OEM).`,
      action: 'Busca el modelo en la web del fabricante para conocer su versión de PCIe y procesadores compatibles.',
    });
  }

  // ---------- Bus PCIe ----------
  const pcie = analyzePcie(gpu, chipset, add);

  // ---------- CPU vs GPU ----------
  const cpuVsGpu = { verdict: 'unknown', ratio: null, cpuScore: cpuEff, gpuScore, bottleneckPct: 0 };
  if (gpu && gpuScore != null && !gpu.integrated) {
    const ratio = gpuScore / cpuEff;
    cpuVsGpu.ratio = round(ratio, 2);
    const softer = (s) => (usage === 'office' && s !== 'ok' ? 'tip' : s);
    if (ratio > 1.1) {
      cpuVsGpu.verdict = 'cpu';
      cpuVsGpu.bottleneckPct = Math.min(60, Math.round((1 - cpuEff / gpuScore) * 100));
      const upgrades = platform && !cpuIsTopOfPlatform(cpuId, platform) ? platform.bestCpus : null;
      add({
        id: 'cpu-bottleneck', severity: softer(ratio > 1.35 ? 'critical' : 'warning'), component: 'cpu',
        title: `Cuello de botella en el procesador (≈${cpuVsGpu.bottleneckPct}%)`,
        detail: `Tu ${cpuId.name} (puntaje ${cpuEff} a ${resolution}) no alcanza a alimentar a la ${gpu.match.name} (${gpuScore}). La GPU quedará esperando al procesador y no llegará al 100% de uso.`,
        action: upgrades
          ? `Sube a ${upgrades.join(' o ')} (compatibles con tu placa${platform.note ? `; ${platform.note.toLowerCase()}` : ''}).`
          : `Tu placa ya no tiene un CPU mucho mejor: cambia a ${modernPlatformAdvice(prefs)}. Mientras tanto, jugar a mayor resolución reduce el cuello de botella.`,
      });
    } else if (ratio < 0.5) {
      cpuVsGpu.verdict = 'gpu';
      add({
        id: 'gpu-weak-vs-cpu', severity: softer(ratio < 0.3 ? 'warning' : 'tip'), component: 'gpu',
        title: 'La tarjeta de video limita al procesador',
        detail: `Tu procesador (${cpuEff}) puede mover una GPU mucho más potente que la ${gpu.match.name} (${gpuScore}). La mejora más rentable es cambiar la tarjeta de video.`,
        action: `GPUs que tu CPU aprovecharía: ${suggest(cpuEff * 0.55, cpuEff * 1.0).join(', ') || 'gama media/alta actual'}.`,
      });
    } else {
      cpuVsGpu.verdict = 'balanced';
      add({
        id: 'cpu-gpu-balanced', severity: 'ok', component: 'cpu',
        title: 'Procesador y GPU equilibrados',
        detail: `CPU ${cpuEff} vs GPU ${gpuScore} a ${resolution}: ninguno frena notablemente al otro.`,
      });
    }
  }

  // ---------- GPU ----------
  if (usage !== 'office' && (!gpu || gpu.integrated)) {
    const cap = Math.min(ceiling ?? cpuEff, cpuEff);
    add({
      id: 'igpu-only', severity: usage === 'gaming' ? 'critical' : 'warning', component: 'gpu',
      title: 'Sólo hay gráficos integrados',
      detail: `${gpu?.name || 'La GPU integrada'} comparte la memoria RAM y tiene un rendimiento muy bajo para ${usage === 'gaming' ? 'juegos' : 'edición y render'}.`,
      action: `Instala una tarjeta dedicada. Recomendadas para tu equipo: ${suggest(cap * 0.35, cap * 0.8).join(', ') || 'RTX 4060 / RX 7600'}.`,
    });
  } else if (gpu && !gpu.integrated && usage !== 'office') {
    const v = gpu.vramGb;
    const need = usage === 'creation' ? 12 : resolution === '1080p' ? 8 : 12;
    if (v && v < 4) add({ id: 'vram', severity: 'critical', component: 'gpu', title: `Memoria de video insuficiente (${v} GB)`, detail: 'Los juegos y programas actuales necesitan al menos 6-8 GB de VRAM; con menos habrá tirones y texturas borrosas.', action: 'Cambia a una tarjeta con 8 GB o más (idealmente 12 GB).' });
    else if (v && v < 8) add({ id: 'vram', severity: 'warning', component: 'gpu', title: `VRAM justa (${v} GB)`, detail: `Con ${v} GB tendrás que bajar texturas en juegos recientes.`, action: 'Para la próxima GPU busca 12 GB de VRAM o más.' });
    else if (v && v < need) add({ id: 'vram', severity: 'tip', component: 'gpu', title: `VRAM correcta, pero al límite para ${resolution}`, detail: `${v} GB alcanza hoy, aunque algunos juegos a ${resolution} ya piden ${need} GB.`, action: `En tu próxima tarjeta apunta a ${need}+ GB.` });
  }

  // ---------- RAM ----------
  const ram = analyzeRam(profile, usage, cpuId, gpu, add);

  // ---------- Almacenamiento ----------
  const storage = analyzeStorage(profile, add);

  // ---------- Sistema ----------
  if (profile.power?.guid === POWER_SAVER) {
    add({ id: 'power-plan', severity: 'warning', component: 'system', title: 'Plan de energía en "Ahorro de energía"', detail: 'Windows limita la frecuencia del procesador para ahorrar energía.', action: 'Panel de control → Opciones de energía → elige "Equilibrado" o "Alto rendimiento".' });
  }
  const biosDate = profile.bios?.releaseDate ? new Date(profile.bios.releaseDate) : null;
  if (biosDate && !isNaN(biosDate)) {
    const years = (Date.now() - biosDate.getTime()) / (365.25 * 864e5);
    if (years > 3) add({ id: 'bios-old', severity: 'tip', component: 'board', title: `BIOS de hace ${Math.floor(years)} años`, detail: `Versión ${profile.bios.version} (${profile.bios.releaseDate}). Las BIOS nuevas mejoran compatibilidad con CPUs, RAM y estabilidad.`, action: `Descarga la última BIOS de ${profile.board?.manufacturer || 'tu placa'} para el modelo ${profile.board?.model || ''}.` });
  }
  if (cpuId.estimated) {
    add({ id: 'cpu-unknown', severity: 'tip', component: 'cpu', title: 'Procesador no reconocido con precisión', detail: `El puntaje de "${cpuId.name}" se estimó a partir de núcleos y frecuencia.`, action: 'Los resultados de equilibrio CPU/GPU son aproximados.' });
  }

  const upgrades = planUpgrades({ cpuId, cpuEff, gpu, ceiling, platformKey, platform, chipset, resFactor, resolution, usage, findings, ram, prefs });

  // ---------- Puntaje global ----------
  const penalty = findings.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0);
  const health = Math.max(5, 100 - penalty);
  const order = { critical: 0, warning: 1, tip: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    settings: { usage, resolution, profile: prefs.name },
    health,
    counts: countBy(findings),
    components: {
      cpu: { ...cpuId, effScore: cpuEff },
      board: { ...profile.board, chipset, platform: platform ? { key: platformKey, ...platform, effCeiling: ceiling } : null },
      gpu,
      gpus,
      ram,
      storage,
    },
    balance: { boardVsGpu, cpuVsGpu, pcie },
    upgrades,
    findings,
  };
}

function analyzePcie(gpu, chipset, add) {
  const out = { slotGen: chipset?.gpuPcie ?? null, gpuGen: null, lanes: null, curWidth: null, curGen: null, effBW: null, fullBW: null };
  if (!gpu || gpu.integrated) return out;
  const m = gpu.pcie || {};
  out.gpuGen = m.maxGen || gpu.match?.pcie || null;
  out.lanes = m.maxWidth || gpu.match?.lanes || null;
  out.curWidth = m.curWidth || null;
  out.curGen = m.curGen || null;
  if (!out.gpuGen || !out.lanes) return out;

  const linkGen = out.slotGen ? Math.min(out.slotGen, out.gpuGen) : out.gpuGen;
  const lanes = out.curWidth ? Math.min(out.curWidth, out.lanes) : out.lanes;
  out.linkGen = linkGen;
  out.effBW = round(hw.pcieBandwidth(linkGen, lanes), 1);
  out.fullBW = round(hw.pcieBandwidth(out.gpuGen, out.lanes), 1);

  if (out.curWidth && out.curWidth < out.lanes) {
    add({
      id: 'pcie-width', severity: out.curWidth <= 4 && out.lanes >= 16 ? 'critical' : 'warning', component: 'board',
      title: `La tarjeta funciona a x${out.curWidth} en vez de x${out.lanes}`,
      detail: `El enlace PCIe de la GPU está usando sólo ${out.curWidth} de sus ${out.lanes} carriles (${out.effBW} GB/s de ${out.fullBW} GB/s).`,
      action: 'Colócala en el slot PCIe x16 superior (el más cercano al procesador), limpia los contactos y revisa en el manual si un SSD M.2 comparte carriles con ese slot.',
    });
  }
  if (out.slotGen && out.slotGen < out.gpuGen) {
    const name = gpu.match?.name || gpu.name;
    if (out.effBW < 4.5) {
      add({ id: 'pcie-gen', severity: 'critical', component: 'board', title: `El PCIe ${out.slotGen}.0 de la placa estrangula a la tarjeta`, detail: `La ${name} es PCIe ${out.gpuGen}.0 x${out.lanes}; en esta placa sólo dispone de ${out.effBW} GB/s. Pérdida estimada: 10-25 %, más cuando se llena la VRAM.`, action: `Usa una placa con PCIe ${out.gpuGen}.0 o una tarjeta con 16 carriles.` });
    } else if (out.effBW < 9) {
      add({ id: 'pcie-gen', severity: 'warning', component: 'board', title: `La placa (PCIe ${out.slotGen}.0) limita a la tarjeta x${out.lanes}`, detail: `La ${name} sólo tiene ${out.lanes} carriles; en PCIe ${out.slotGen}.0 queda con ${out.effBW} GB/s. Pérdida estimada: 3-8 %.`, action: `Con una placa PCIe ${out.gpuGen}.0 recuperarías ese rendimiento.` });
    } else {
      add({ id: 'pcie-gen', severity: 'tip', component: 'board', title: `Slot PCIe ${out.slotGen}.0 con tarjeta PCIe ${out.gpuGen}.0`, detail: `La tarjeta trabaja a PCIe ${out.slotGen}.0 x${lanes} (${out.effBW} GB/s). La diferencia real es de 1-3 %, no es un problema.` });
    }
  }
  return out;
}

function analyzeRam(profile, usage, cpuId, gpu, add) {
  const r = profile.ram || {};
  const modules = (r.modules || []).filter((m) => m.size > 0);
  const totalGb = modules.length ? Math.round(modules.reduce((s, m) => s + m.size, 0) / GB) : Math.round((r.total || 0) / GB);
  const type = modules[0]?.type || null;
  const configured = modules[0]?.configuredSpeed || null;
  const rated = modules.map((m) => hw.ratedSpeedFromPart(m.partNum)).filter(Boolean);
  const ratedSpeed = rated.length ? Math.min(...rated) : null;
  const slots = r.slots || null;
  const maxGb = r.maxCapacity ? Math.round(r.maxCapacity / GB) : null;
  const usedPct = r.total ? Math.round(((r.total - (r.available ?? r.free ?? 0)) / r.total) * 100) : null;
  const out = { totalGb, type, configured, ratedSpeed, modules: modules.length, slots, maxGb, usedPct, channel: modules.length >= 2 ? 'dual' : modules.length === 1 ? 'single' : 'unknown' };

  const t = RAM_TARGETS[usage];
  const kit = (gb) => `${gb} GB (2×${gb / 2} GB${type ? ` ${type}` : ''})`;
  const maxNote = maxGb ? ` Tu placa admite hasta ${maxGb} GB.` : '';
  if (totalGb && totalGb < t.critical) {
    add({ id: 'ram-size', severity: 'critical', component: 'ram', title: `Memoria RAM insuficiente: ${totalGb} GB`, detail: `Con ${totalGb} GB el sistema usará el disco como memoria virtual y todo se volverá lento.`, action: `Aumenta a ${kit(t.warning)} como mínimo.${maxNote}` });
  } else if (totalGb && totalGb < t.warning) {
    add({ id: 'ram-size', severity: 'warning', component: 'ram', title: `RAM justa: ${totalGb} GB`, detail: `Para ${usageLabel(usage)} se recomiendan ${t.warning} GB; con ${totalGb} GB habrá tirones con varios programas abiertos.`, action: `Sube a ${kit(t.warning)}.${maxNote}` });
  } else if (totalGb && totalGb < t.tip) {
    add({ id: 'ram-size', severity: 'ok', component: 'ram', title: `Cantidad de RAM adecuada: ${totalGb} GB`, detail: `Suficiente para ${usageLabel(usage)}. Si haces streaming o tienes muchas apps abiertas, ${t.tip} GB dan margen extra.` });
  } else if (totalGb) {
    add({ id: 'ram-size', severity: 'ok', component: 'ram', title: `RAM de sobra: ${totalGb} GB`, detail: 'La cantidad de memoria no es un cuello de botella.' });
  }

  if (modules.length === 1 && (!slots || slots >= 2)) {
    add({ id: 'ram-single', severity: gpu?.integrated ? 'critical' : 'warning', component: 'ram', title: 'RAM en canal simple (1 módulo)', detail: 'Con un solo módulo el procesador recibe la mitad del ancho de banda. En juegos se pierde entre 10 % y 30 % de FPS (más con gráficos integrados).', action: `Agrega un segundo módulo idéntico (${Math.round(modules[0].size / GB)} GB${type ? ` ${type}` : ''}${configured ? ` a ${configured} MT/s` : ''}) para activar el doble canal.` });
  } else if (modules.length === 3) {
    add({ id: 'ram-odd', severity: 'tip', component: 'ram', title: '3 módulos de RAM', detail: 'Con un número impar de módulos parte de la memoria trabaja en canal simple.', action: 'Usa 2 o 4 módulos iguales.' });
  }
  const sizes = new Set(modules.map((m) => m.size));
  const parts = new Set(modules.map((m) => (m.partNum || '').trim()).filter(Boolean));
  if (modules.length > 1 && (sizes.size > 1 || parts.size > 1)) {
    add({ id: 'ram-mixed', severity: 'warning', component: 'ram', title: 'Módulos de RAM mezclados', detail: 'Hay módulos de distinta capacidad o modelo. La memoria funcionará a la velocidad del más lento y puede perder el doble canal completo o ser inestable.', action: 'Usa un kit de módulos idénticos.' });
  }

  if (configured && ratedSpeed && ratedSpeed > configured + 100) {
    add({ id: 'ram-xmp', severity: 'warning', component: 'ram', title: `La RAM no va a su velocidad: ${configured} de ${ratedSpeed} MT/s`, detail: `Tus módulos son de ${ratedSpeed} MT/s pero trabajan a ${configured} MT/s (perfil por defecto). Estás perdiendo rendimiento gratis.`, action: `Entra a la BIOS y activa ${cpuId.family?.vendor === 'AMD' ? 'EXPO / DOCP' : 'XMP'} para que la RAM trabaje a ${ratedSpeed} MT/s.` });
  } else if (configured && !ratedSpeed && ((type === 'DDR4' && configured <= 2400) || (type === 'DDR5' && configured <= 4800))) {
    add({ id: 'ram-xmp', severity: 'tip', component: 'ram', title: `RAM a velocidad base (${configured} MT/s)`, detail: `${configured} MT/s es la velocidad estándar JEDEC. Si tus módulos son más rápidos, no se está aprovechando.`, action: `Revisa en la BIOS si puedes activar ${cpuId.family?.vendor === 'AMD' ? 'EXPO / DOCP' : 'XMP'}.` });
  }

  if (slots && modules.length < slots && totalGb < t.tip && usage !== 'office') {
    add({ id: 'ram-slots', severity: 'tip', component: 'ram', title: `${slots - modules.length} ranuras de RAM libres`, detail: `Tienes ${modules.length} de ${slots} ranuras ocupadas.${maxNote}`, action: 'Puedes ampliar sin quitar tus módulos actuales (idealmente con el mismo modelo).' });
  }
  if (usedPct != null && usedPct >= 85) {
    add({ id: 'ram-usage', severity: 'warning', component: 'ram', title: `Uso de RAM alto ahora mismo (${usedPct} %)`, detail: 'La memoria está casi llena; Windows empezará a usar el disco.', action: 'Cierra programas en segundo plano o amplía la RAM.' });
  }
  return out;
}

function analyzeStorage(profile, add) {
  const disks = profile.disks || [];
  const system = disks.find((d) => d.isSystem) || null;
  const sysVol = (profile.volumes || []).find((v) => /^c:?$/i.test(v.mount?.replace(/\\$/, '')));
  const freePct = sysVol?.size ? Math.round(((sysVol.size - sysVol.used) / sysVol.size) * 100) : null;

  if (system?.type === 'HDD') {
    add({ id: 'os-hdd', severity: 'critical', component: 'storage', title: 'Windows está en un disco duro mecánico (HDD)', detail: `El disco del sistema (${system.name}) es mecánico: arranques, cargas de juegos y programas son 5-20 veces más lentos que en un SSD.`, action: 'Instala Windows en un SSD NVMe (por ejemplo 1 TB PCIe 4.0) y deja el HDD para archivos.' });
  } else if (system?.type === 'SSD' && system.bus === 'SATA') {
    add({ id: 'os-sata', severity: 'tip', component: 'storage', title: 'Sistema en SSD SATA', detail: 'Un SSD SATA es rápido, aunque un NVMe es entre 3 y 10 veces más veloz en lectura secuencial.', action: 'Si tu placa tiene ranura M.2 NVMe, considera mover el sistema y los juegos a un NVMe.' });
  } else if (system?.type === 'SSD') {
    add({ id: 'os-ssd', severity: 'ok', component: 'storage', title: `Sistema en SSD ${system.bus || ''}`.trim(), detail: `${system.name}: el almacenamiento del sistema no es un cuello de botella.` });
  }
  if (freePct != null && freePct < 10) {
    add({ id: 'disk-space', severity: freePct < 5 ? 'critical' : 'warning', component: 'storage', title: `Poco espacio libre en C: (${freePct} %)`, detail: 'Con menos del 10 % libre Windows y los SSD pierden rendimiento y las actualizaciones pueden fallar.', action: 'Libera espacio (Configuración → Sistema → Almacenamiento) o mueve juegos a otra unidad.' });
  }
  if (disks.some((d) => d.type === 'HDD' && !d.isSystem)) {
    add({ id: 'hdd-games', severity: 'tip', component: 'storage', title: 'Tienes discos mecánicos (HDD)', detail: 'Son útiles para guardar archivos, pero los juegos instalados en HDD cargan mucho más lento y pueden dar tirones.', action: 'Instala juegos y programas pesados en el SSD.' });
  }
  return { system, freePct, disks };
}

function cpuIsTopOfPlatform(cpuId, platform) {
  const top = platform.bestCpus.map((n) => n.toLowerCase().replace(/core |ryzen \d /g, ''));
  const mine = cpuId.name.toLowerCase();
  return top.some((t) => mine.includes(t.replace(/\s+/g, ' ')));
}

function modernPlatformAdvice(prefs = {}) {
  const amd = 'una placa AM5 (B650/B850) con Ryzen 7 7800X3D/9800X3D';
  const intel = 'una placa LGA 1851 (B860/Z890) con Core Ultra 7 265K';
  if (prefs.cpuBrand === 'AMD') return amd;
  if (prefs.cpuBrand === 'Intel') return intel;
  return `${amd}, o ${intel}`;
}

function usageLabel(u) {
  return { gaming: 'juegos', creation: 'edición y creación de contenido', office: 'uso de oficina' }[u];
}

function countBy(findings) {
  return findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), { critical: 0, warning: 0, tip: 0, ok: 0 });
}

// ---------- Diagnóstico en vivo ----------
// samples: [{ cpu, cpuMaxCore, ram, gpu, vram, gpuTemp }] de los últimos segundos.
function liveBottleneck(samples) {
  if (!samples.length) return null;
  const avg = (k) => {
    const v = samples.map((s) => s[k]).filter((x) => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const cpu = avg('cpu');
  const core = avg('cpuMaxCore');
  const ram = avg('ram');
  const gpu = avg('gpu');
  const vram = avg('vram');
  const temp = avg('gpuTemp');
  const alerts = [];
  if (ram != null && ram >= 90) alerts.push({ severity: 'critical', component: 'ram', text: `RAM al ${Math.round(ram)} %: el sistema está usando el disco como memoria. Cuello de botella de RAM.` });
  if (vram != null && vram >= 95) alerts.push({ severity: 'warning', component: 'gpu', text: `VRAM al ${Math.round(vram)} %: baja la calidad de texturas.` });
  if (temp != null && temp >= 85) alerts.push({ severity: 'warning', component: 'gpu', text: `GPU a ${Math.round(temp)} °C: revisa ventilación y limpieza.` });

  let state = 'idle';
  if (gpu != null && gpu >= 93) state = 'gpu-bound';
  else if (gpu != null && gpu < 80 && (cpu >= 85 || core >= 95) && gpu > 15) state = 'cpu-bound';
  else if (cpu >= 85 || core >= 95) state = 'cpu-busy';
  else if (gpu != null && gpu > 50) state = 'balanced';
  return { state, cpu, core, ram, gpu, vram, temp, alerts };
}

module.exports = { analyze, liveBottleneck };
