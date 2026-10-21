// "Verifica antes de comprar": comprobaciones que HardScope no puede hacer por sí solo
// (lista de CPUs de la placa, BIOS, tamaño de la tarjeta, conectores y fuente).

function cpuCheck(board = {}, cpuName = null) {
  const maker = board.manufacturer || 'el fabricante de tu placa';
  const model = board.model ? `la ${board.model}` : 'tu placa';
  return `Compatibilidad: confirma en la web de ${maker} que ${cpuName || 'el procesador elegido'} aparece en la lista de CPUs compatibles de ${model} y qué versión mínima de BIOS necesita. Actualiza la BIOS antes de instalarlo.`;
}

function gpuChecks(watts = null) {
  return [
    'Tamaño: mide el espacio libre en tu gabinete y compáralo con el largo de la tarjeta (ficha del fabricante). Las de gama alta suelen superar los 30 cm y ocupar 2,5–3 ranuras.',
    `Energía: revisa qué conectores pide la tarjeta (8 pines o 12V-2x6 de 16 pines) y que tu fuente los tenga${watts ? ` y entregue al menos ≈ ${watts} W` : ''}. HardScope no puede leer la fuente: mira su etiqueta lateral.`,
  ];
}

function platformChecks() {
  return [
    'Placa y procesador: confirma en la lista de CPUs compatibles de la placa que el procesador funciona con la BIOS de fábrica; si no, elige una placa con BIOS Flashback o pide en la tienda que la actualicen.',
    'Memoria: el kit debe ser DDR5 y, idealmente, figurar en la lista de memorias compatibles (QVL) de la placa.',
    'Disipador: verifica que tu disipador tenga anclaje para el nuevo socket o considera uno nuevo.',
    'Windows: al cambiar la placa puede pedir reactivación; vincula antes tu licencia a tu cuenta Microsoft.',
  ];
}

module.exports = { cpuCheck, gpuChecks, platformChecks };
