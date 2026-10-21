// Captura el inventario de este PC como caso de prueba anónimo.
// Uso:  npm run fixture -- mi-pc-gamer
// Crea test/fixtures/<nombre>.json. Revísalo antes de compartirlo (por ejemplo en un PR).
const fs = require('fs');
const path = require('path');
const { collect } = require('../src/main/collector');

// Quita lo que identifica a la persona o al equipo; conserva lo que describe el hardware.
function anonymize(p) {
  return {
    ...p,
    collectedAt: p.collectedAt.slice(0, 7) + '-01T00:00:00.000Z', // sólo año y mes
    os: { ...p.os, hostname: null },
    displays: (p.displays || []).map((d) => ({ ...d, model: null })),
    volumes: (p.volumes || []).map((v, i) => ({ ...v, mount: /^c:?\\?$/i.test(v.mount) ? 'C:' : `VOL${i}` })),
  };
}

(async () => {
  const name = (process.argv[2] || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!name) {
    console.error('Indica un nombre: npm run fixture -- mi-pc-gamer');
    process.exit(1);
  }
  const profile = anonymize(await collect());
  const fixture = {
    origin: 'real',
    description: `${profile.system.manufacturer || ''} ${profile.system.model || ''}`.trim(),
    captured: profile.collectedAt.slice(0, 7),
    // Completa "expect" con lo que sabes que es cierto de este equipo (ver test/fixtures.test.js).
    expect: {},
    profile,
  };
  const file = path.join(__dirname, '..', 'test', 'fixtures', `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`Guardado ${path.relative(process.cwd(), file)}`);
  if (profile.issues?.length) console.log(`Atención: ${profile.issues.length} dato(s) no se pudieron leer.`);
  console.log('Revisa el archivo antes de compartirlo: no incluye el nombre del equipo, pero sí modelos y números de parte.');
})();
