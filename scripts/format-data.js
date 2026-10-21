// Da formato a los catálogos de src/data: metadatos legibles y una línea por entrada,
// para que agregar o revisar un modelo sea editar una sola línea.
// Uso: node scripts/format-data.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'data');
const line = (v) => JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{"/, '{ "').replace(/\}$/, ' }');

function formatObject(obj, compactKeys) {
  const parts = Object.entries(obj).map(([k, v]) => {
    if (!compactKeys.includes(k)) return `  ${JSON.stringify(k)}: ${JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')}`;
    if (Array.isArray(v)) return `  ${JSON.stringify(k)}: [\n${v.map((e) => `    ${line(e)}`).join(',\n')}\n  ]`;
    return `  ${JSON.stringify(k)}: {\n${Object.entries(v).map(([ik, iv]) => `    ${JSON.stringify(ik)}: ${line(iv)}`).join(',\n')}\n  }`;
  });
  return `{\n${parts.join(',\n')}\n}\n`;
}

const files = { 'gpus.json': ['gpus'], 'platforms.json': ['platforms', 'chipsets', 'modern'], 'brands.json': ['pciVendors', 'gpuMakers', 'gpuSeries', 'boards', 'psu', 'ram', 'storage'] };
for (const [file, compact] of Object.entries(files)) {
  const full = path.join(dir, file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  const out = formatObject(data, compact);
  JSON.parse(out); // nunca escribir un JSON inválido
  fs.writeFileSync(full, out);
  console.log(`formateado ${file}`);
}
