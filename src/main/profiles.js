// Perfiles de preferencias del usuario, guardados en la carpeta de datos de la app.
const { app } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const FIELDS = ['name', 'cpuBrand', 'gpuBrand', 'gpuMaker', 'boardBrand', 'psuBrand', 'ramBrand', 'storageBrand', 'budget', 'usage', 'resolution'];
const file = () => path.join(app.getPath('userData'), 'profiles.json');

async function load() {
  try {
    const data = JSON.parse(await fs.readFile(file(), 'utf8'));
    return { active: data.active ?? null, profiles: Array.isArray(data.profiles) ? data.profiles : [] };
  } catch {
    return { active: null, profiles: [] };
  }
}

async function write(data) {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function clean(p) {
  const out = { id: p.id || `p${Date.now().toString(36)}` };
  for (const k of FIELDS) out[k] = typeof p[k] === 'string' && p[k].trim() ? p[k].trim().slice(0, 60) : null;
  out.name = out.name || 'Mi perfil';
  return out;
}

async function save(profile) {
  const data = await load();
  const p = clean(profile);
  const i = data.profiles.findIndex((x) => x.id === p.id);
  if (i >= 0) data.profiles[i] = p;
  else data.profiles.push(p);
  data.active = p.id;
  return write(data);
}

async function remove(id) {
  const data = await load();
  data.profiles = data.profiles.filter((p) => p.id !== id);
  if (data.active === id) data.active = null;
  return write(data);
}

async function activate(id) {
  const data = await load();
  data.active = data.profiles.some((p) => p.id === id) ? id : null;
  return write(data);
}

module.exports = { load, save, remove, activate };
