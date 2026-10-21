// Dos lecturas de cada hallazgo, a partir del mismo cálculo:
//  - plain:    título y frase en lenguaje cotidiano (vista Simple).
//  - evidence: valores, umbrales y origen de los datos (vista Developer).
const THRESHOLDS = {
  cpu: 'GPU/CPU > 1,10 advertencia · > 1,60 crítico · < 0,50 la GPU es el límite',
  board: 'GPU/plataforma > 1,10 advertencia · > 1,50 crítico · < 0,60 placa superior',
};

const PLAIN = {
  'cpu-bottleneck': ['Tu procesador podría frenar a tu tarjeta de video en algunos juegos', 'En juegos que exigen mucho al procesador, la tarjeta no siempre trabajará al máximo.'],
  'gpu-weak-vs-cpu': ['La tarjeta de video es lo que más limita tus juegos', 'Tu procesador da para una tarjeta mejor: cambiar la tarjeta es lo que más se notaría.'],
  'cpu-gpu-balanced': ['Tu procesador y tu tarjeta de video están bien emparejados', 'Ninguno de los dos debería frenar claramente al otro.'],
  'board-limits-gpu': ['Tu placa y tu procesador se quedan cortos para esta tarjeta', 'La tarjeta es más potente de lo que el resto del equipo aprovecha en muchos juegos.'],
  'board-superior': ['Tu placa admite una tarjeta de video mejor', 'Si quieres más rendimiento en juegos, puedes cambiar solo la tarjeta.'],
  'board-gpu-balanced': ['Tu placa y tu tarjeta de video están bien emparejadas', 'No hace falta cambiar ninguna de las dos por este motivo.'],
  'pcie-width': ['La tarjeta de video no está usando toda su conexión', 'Puede estar en la ranura equivocada o mal colocada.'],
  'ram-single': ['Tienes un solo módulo de memoria RAM', 'Con dos módulos iguales el equipo rinde mejor, sobre todo en juegos.'],
  'ram-same-channel': ['Los módulos de RAM están en ranuras que no conviene', 'Cambiarlos de ranura hace que la memoria rinda mejor.'],
  'ram-odd': ['Tienes un número impar de módulos de RAM', 'Con 2 o 4 módulos iguales la memoria rinde mejor.'],
  'ram-mixed': ['Tienes módulos de RAM distintos', 'Lo ideal es usar módulos iguales para evitar problemas.'],
  'ram-slots': ['Tienes espacio para más memoria RAM', 'Puedes ampliar sin quitar la que ya tienes.'],
  'ram-usage': ['Tu memoria RAM está casi llena ahora mismo', 'Cierra los programas que no estés usando.'],
  'igpu-only': ['No tienes una tarjeta de video dedicada', 'Los gráficos integrados rinden poco para juegos y edición.'],
  'os-hdd': ['Windows está instalado en un disco lento', 'Pasar Windows a un disco SSD hace que todo arranque y cargue mucho más rápido.'],
  'os-sata': ['El disco del sistema podría ser más rápido', 'Un SSD de tipo NVMe es varias veces más rápido que el actual.'],
  'os-ssd': ['El disco del sistema es rápido', 'No hace falta cambiarlo.'],
  'hdd-games': ['Tienes discos lentos (mecánicos)', 'Úsalos para guardar archivos, no para instalar juegos.'],
  'disk-space': ['Te queda poco espacio en el disco C:', 'Libera espacio para que Windows funcione bien.'],
  'power-plan': ['Windows está en modo de ahorro de energía', 'Cámbialo a «Equilibrado» o «Alto rendimiento» para que el procesador rinda más.'],
  'bios-old': ['La BIOS de tu placa es antigua', 'Actualizarla mejora la compatibilidad y la estabilidad.'],
  'gpu-unknown': ['No reconocimos tu tarjeta de video', 'Algunas comparaciones no se pudieron hacer.'],
  'cpu-unknown': ['No reconocimos tu procesador con exactitud', 'Algunos resultados pueden ser menos precisos.'],
  'board-unknown': ['No reconocimos el modelo de tu placa', 'Algunas comparaciones no se pudieron hacer.'],
  'board-inferred': ['No reconocimos el modelo de tu placa', 'Usamos tu procesador para estimar qué admite; algunos datos de la placa pueden faltar.'],
};

// Textos que dependen de la severidad del hallazgo.
function plainFor(f) {
  if (f.id === 'pcie-gen') {
    return f.severity === 'tip'
      ? ['La conexión de tu placa es algo más antigua que la tarjeta', 'La diferencia es mínima; no hace falta hacer nada.']
      : ['La conexión de la placa le quita rendimiento a la tarjeta', 'Tu placa es de una generación anterior a la tarjeta y la limita.'];
  }
  if (f.id === 'ram-xmp') {
    return f.severity === 'tip'
      ? ['Tu memoria RAM podría estar funcionando a velocidad básica', 'Revisa en la BIOS si se puede activar XMP o EXPO.']
      : ['Tu memoria RAM funciona más lenta de lo que puede', 'Se arregla gratis activando una opción en la BIOS (XMP o EXPO).'];
  }
  if (f.id === 'vram') {
    return f.severity === 'tip'
      ? ['La memoria de tu tarjeta está justa para la resolución elegida', 'Alcanza hoy, pero algunos juegos nuevos ya piden más.']
      : ['Tu tarjeta de video tiene poca memoria propia', 'En juegos recientes tendrás que bajar la calidad de las texturas.'];
  }
  if (f.id === 'ram-size') {
    return f.severity === 'ok' ? [f.title, 'La cantidad de memoria no limita al equipo.'] : [f.title, 'Con más memoria el equipo irá más fluido con varios programas abiertos.'];
  }
  return PLAIN[f.id] || [f.title, null];
}

function annotate(findings, ctx) {
  const { cpuId, gpu, chipset, platformKey, boardVsGpu, cpuVsGpu, pcie, ram, resolution, resFactor } = ctx;
  const gpuSource = gpu?.match ? `gpus.json · id «${gpu.match.id}»${gpu.match.laptop ? ' (portátil ×0,8)' : ''} · confianza ${gpu.match.conf}` : 'no está en la base de datos';
  const cpuSource = cpuId.estimated ? 'estimado por núcleos y frecuencia (modelo no reconocido)' : `base por generación y gama (${cpuId.family?.line || ''} ${cpuId.family?.gen || ''})`.replace(/\s+\)/, ')');
  const res = `${resolution} (factor CPU ×${resFactor})`;

  const ev = {
    cpu: () => [
      ['Índice CPU', `${cpuVsGpu.cpuScore} a ${res}`],
      ['Índice GPU', cpuVsGpu.gpuScore ?? '—'],
      ['Relación GPU/CPU', cpuVsGpu.ratio ?? '—'],
      ['Umbrales', THRESHOLDS.cpu],
      ['Origen CPU', cpuSource],
      ['Origen GPU', gpuSource],
    ],
    board: () => [
      ['Índice plataforma', `${boardVsGpu.ceiling ?? '—'} a ${resolution}`],
      ['Índice GPU', boardVsGpu.gpuScore ?? '—'],
      ['Relación GPU/plataforma', boardVsGpu.ratio ?? '—'],
      ['Umbrales', THRESHOLDS.board],
      ['Plataforma', `${platformKey || '—'} (platforms.json)`],
      ['Chipset', chipset ? `${chipset.id}, deducido del modelo de placa` : 'no identificado'],
    ],
    pcie: () => [
      ['Slot de la placa', pcie.slotGen ? `PCIe ${pcie.slotGen}.0 (platforms.json, según chipset)` : '—'],
      ['Tarjeta', pcie.gpuGen ? `PCIe ${pcie.gpuGen}.0 x${pcie.lanes} (${gpu?.pcie?.maxGen ? 'medido por Windows' : 'base de datos'})` : '—'],
      ['Enlace actual', pcie.curWidth ? `Gen ${pcie.curGen} x${pcie.curWidth} (Windows, DEVPKEY_PciDevice)` : 'no disponible'],
      ['Ancho de banda', pcie.effBW ? `${pcie.effBW} de ${pcie.fullBW} GB/s` : '—'],
    ],
    ram: () => [
      ['Velocidad configurada', ram.configured ? `${ram.configured} MT/s (la del módulo más lento, WMI)` : '—'],
      ['Velocidad nominal', ram.ratedSpeed ? `${ram.ratedSpeed} MT/s (deducida del número de parte)` : 'no determinada'],
      ['Canal', `${ram.channel} (según etiquetas de ranura)`],
      ['Módulos / ranuras', `${ram.modules} / ${ram.slots ?? '?'}`],
    ],
  };
  const EVIDENCE = {
    'cpu-bottleneck': ev.cpu, 'gpu-weak-vs-cpu': ev.cpu, 'cpu-gpu-balanced': ev.cpu,
    'board-limits-gpu': ev.board, 'board-superior': ev.board, 'board-gpu-balanced': ev.board,
    'pcie-width': ev.pcie, 'pcie-gen': ev.pcie,
    'ram-xmp': ev.ram, 'ram-single': ev.ram, 'ram-same-channel': ev.ram, 'ram-mixed': ev.ram, 'ram-odd': ev.ram, 'ram-size': ev.ram, 'ram-slots': ev.ram,
    vram: () => [['VRAM', `${gpu?.vramGb ?? '—'} GB`], ['Origen GPU', gpuSource]],
  };

  for (const f of findings) {
    const [title, text] = plainFor(f);
    // Acción sin aclaraciones numéricas entre paréntesis ("(≈ 99.8 puntos)").
    f.plain = { title, text, action: f.action ? f.action.replace(/\s*\([^)]*(≈|puntos|índice)[^)]*\)/g, '') : null };
    f.evidence = EVIDENCE[f.id] ? EVIDENCE[f.id]().map(([k, v]) => [k, String(v)]) : [];
  }
  return findings;
}

module.exports = { annotate };
