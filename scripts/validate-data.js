// Uso: npm run validate  — revisa los catálogos de src/data antes de publicar.
const { validate } = require('../src/analysis/validate-data');

const { errors, warnings } = validate();
for (const w of warnings) console.log(`  aviso  ${w}`);
for (const e of errors) console.log(`  ERROR  ${e}`);
console.log(`\n${errors.length} error(es), ${warnings.length} aviso(s).`);
process.exit(errors.length ? 1 : 0);
