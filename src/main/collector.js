// Recolecta el perfil estático del hardware (systeminformation + probe.ps1).
const si = require('systeminformation');
const path = require('path');
const { execFile } = require('child_process');
const { MEM_TYPE } = require('../analysis/hardware');

function runPowerShellFile(file, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve(null);
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

async function collect() {
  const isWin = process.platform === 'win32';
  const [cpu, board, bios, mem, memLayout, graphics, diskLayout, fsSize, os, system, probe] = await Promise.all([
    si.cpu(),
    si.baseboard(),
    si.bios(),
    si.mem(),
    si.memLayout(),
    si.graphics(),
    si.diskLayout(),
    si.fsSize(),
    si.osInfo(),
    si.system(),
    isWin ? runPowerShellFile(scriptPath('probe.ps1')) : Promise.resolve(null),
  ]);

  const probeGpus = asArray(probe?.gpus);
  const gpus = graphics.controllers.map((c) => {
    const p = probeGpus.find((g) => g.name && c.model && (g.name.includes(c.model) || c.model.includes(g.name)));
    return {
      name: c.model || c.name,
      vendor: c.vendor,
      vram: c.vram || 0,
      driverVersion: c.driverVersion || null,
      bus: c.bus,
      pcie: p ? { curGen: p.curGen, curWidth: p.curWidth, maxGen: p.maxGen, maxWidth: p.maxWidth } : null,
    };
  });

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
      }))
    : memLayout.map((m) => ({
        size: m.size,
        type: m.type,
        configuredSpeed: m.clockSpeed,
        partNum: m.partNum,
        manufacturer: m.manufacturer,
        locator: m.bank,
      }));

  const disks = asArray(probe?.disks).length
    ? asArray(probe.disks).map((d) => ({ name: d.name, type: d.type === 'Unspecified' ? null : d.type, bus: d.bus, size: d.size, isSystem: d.isSystem }))
    : diskLayout.map((d) => ({ name: d.name, type: d.type, bus: d.interfaceType, size: d.size, isSystem: false }));

  return {
    collectedAt: new Date().toISOString(),
    system: { manufacturer: system.manufacturer, model: system.model },
    cpu: {
      brand: `${cpu.manufacturer} ${cpu.brand}`.trim(),
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
    displays: graphics.displays.map((d) => ({ model: d.model, main: d.main, resolutionX: d.currentResX, resolutionY: d.currentResY, refreshRate: d.currentRefreshRate })),
    disks,
    volumes: fsSize.map((v) => ({ mount: v.mount, size: v.size, used: v.used, type: v.type })),
    os: { distro: os.distro, release: os.release, build: os.build, arch: os.arch, hostname: os.hostname },
    power: probe?.power || null,
  };
}

module.exports = { collect, scriptPath };
