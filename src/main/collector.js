// Recolecta el perfil estático del hardware (systeminformation + probe.ps1).
// Cada lectura tiene tiempo límite y valor de respaldo: si algo falla, se registra en
// `issues` para que la interfaz avise qué datos faltan en lugar de fallar en silencio.
const si = require('systeminformation');
const path = require('path');
const { execFile } = require('child_process');
const { MEM_TYPE, brands } = require('../analysis/hardware');
const PCI_VENDORS = brands.pciVendors;

function runPowerShellFile(file, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve({ error: err.killed ? 'tiempo de espera agotado' : err.message });
        try {
          resolve({ data: JSON.parse(stdout.trim()) });
        } catch {
          resolve({ error: 'respuesta no válida' });
        }
      }
    );
  });
}

// En la app empaquetada los .ps1 quedan fuera del asar (ver "asarUnpack").
function scriptPath(name) {
  return path.join(__dirname, name).replace('app.asar', 'app.asar.unpacked');
}

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('tiempo de espera agotado')), ms))]);
}

const LAPTOP_CHASSIS = /notebook|laptop|portable|sub ?notebook|hand ?held|tablet|convertible|detachable/i;

async function collect() {
  const isWin = process.platform === 'win32';
  const issues = [];
  const safe = async (area, label, fn, fallback, ms = 20000) => {
    try {
      return await withTimeout(fn(), ms);
    } catch (err) {
      issues.push({ area, text: `No se pudo leer ${label} (${err.message}).` });
      return fallback;
    }
  };

  const [cpu, board, bios, mem, memLayout, graphics, diskLayout, fsSize, os, system, chassis, battery, probeRes] = await Promise.all([
    safe('cpu', 'el procesador', () => si.cpu(), {}),
    safe('board', 'la placa madre', () => si.baseboard(), {}),
    safe('board', 'la BIOS', () => si.bios(), {}),
    safe('ram', 'el uso de memoria', () => si.mem(), {}),
    safe('ram', 'los módulos de RAM', () => si.memLayout(), []),
    safe('gpu', 'la tarjeta de video', () => si.graphics(), { controllers: [], displays: [] }),
    safe('storage', 'los discos', () => si.diskLayout(), []),
    safe('storage', 'el espacio en disco', () => si.fsSize(), []),
    safe('system', 'el sistema operativo', () => si.osInfo(), {}),
    safe('system', 'el modelo del equipo', () => si.system(), {}),
    safe('system', 'el tipo de equipo', () => si.chassis(), {}),
    safe('system', 'la batería', () => si.battery(), {}),
    isWin ? runPowerShellFile(scriptPath('probe.ps1')) : Promise.resolve({ error: 'sólo disponible en Windows' }),
  ]);

  const probe = probeRes.data || null;
  if (!probe) {
    issues.push({
      area: 'system',
      text: `No se pudieron leer los datos avanzados de Windows (${probeRes.error}). Faltan: enlace PCIe de la GPU, velocidad nominal de la RAM, ranuras libres, disco del sistema, plan de energía y ensambladora de la tarjeta.`,
    });
  }

  const probeGpus = asArray(probe?.gpus);
  const gpus = asArray(graphics.controllers).map((c) => {
    const p = probeGpus.find((g) => g.name && c.model && (g.name.includes(c.model) || c.model.includes(g.name)));
    return {
      name: c.model || c.name,
      vendor: c.vendor,
      vram: c.vram || 0,
      driverVersion: c.driverVersion || null,
      bus: c.bus,
      maker: p?.subsys ? PCI_VENDORS[p.subsys.toUpperCase()] || null : null,
      pcie: p ? { curGen: p.curGen, curWidth: p.curWidth, maxGen: p.maxGen, maxWidth: p.maxWidth } : null,
    };
  });
  if (!gpus.length) issues.push({ area: 'gpu', text: 'No se detectó ninguna tarjeta de video.' });

  const probeMem = asArray(probe?.memory);
  const modules = probeMem.length
    ? probeMem.map((m) => ({
        size: m.size,
        type: MEM_TYPE[m.smbiosType] || null,
        configuredSpeed: m.configuredSpeed || m.speed,
        jedecSpeed: m.speed,
        partNum: m.partNum,
        manufacturer: m.manufacturer,
        locator: m.locator,
        bank: m.bank, // en placas AMD el canal viene aquí ("P0 CHANNEL A")
      }))
    : asArray(memLayout).map((m) => ({
        size: m.size,
        type: m.type,
        configuredSpeed: m.clockSpeed,
        partNum: m.partNum,
        manufacturer: m.manufacturer,
        locator: m.bank,
      }));

  const disks = asArray(probe?.disks).length
    ? asArray(probe.disks).map((d) => ({ name: d.name, type: d.type === 'Unspecified' ? null : d.type, bus: d.bus, size: d.size, isSystem: d.isSystem }))
    : asArray(diskLayout).map((d) => ({ name: d.name, type: d.type, bus: d.interfaceType, size: d.size, isSystem: false }));

  const laptop = LAPTOP_CHASSIS.test(chassis.type || '') || (!!battery.hasBattery && !/desktop|tower|mini ?pc|all in one/i.test(chassis.type || ''));

  return {
    collectedAt: new Date().toISOString(),
    issues,
    system: { manufacturer: system.manufacturer, model: system.model, chassis: chassis.type || null, laptop },
    cpu: {
      brand: `${cpu.manufacturer || ''} ${cpu.brand || ''}`.trim(),
      manufacturer: cpu.manufacturer,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      performanceCores: cpu.performanceCores,
      efficiencyCores: cpu.efficiencyCores,
      speed: cpu.speed,
      speedMax: cpu.speedMax,
      socket: cpu.socket,
      cache: cpu.cache,
    },
    board: { manufacturer: board.manufacturer, model: board.model, version: board.version, memSlots: board.memSlots, memMax: board.memMax },
    bios: { vendor: bios.vendor, version: bios.version, releaseDate: bios.releaseDate },
    ram: { total: mem.total, available: mem.available, free: mem.free, modules, slots: probe?.slots || board.memSlots || null, maxCapacity: probe?.maxCapacity || board.memMax || null },
    gpus,
    displays: asArray(graphics.displays).map((d) => ({ model: d.model, main: d.main, resolutionX: d.currentResX, resolutionY: d.currentResY, refreshRate: d.currentRefreshRate })),
    disks,
    volumes: asArray(fsSize).map((v) => ({ mount: v.mount, size: v.size, used: v.used, type: v.type })),
    os: { distro: os.distro, release: os.release, build: os.build, arch: os.arch, hostname: os.hostname },
    power: probe?.power || null,
  };
}

module.exports = { collect, scriptPath };
