// Monitoreo en vivo: CPU, núcleo más cargado, RAM, GPU, VRAM y temperatura.
const si = require('systeminformation');
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const { scriptPath } = require('./collector');

class LiveMonitor {
  constructor() {
    this.timer = null;
    this.procs = [];
    this.gpu = {};
    this.vramTotal = null;
  }

  start(onSample, vramTotalMb) {
    if (this.timer) return;
    this.vramTotal = vramTotalMb ? vramTotalMb * 1024 * 1024 : null;
    if (process.platform === 'win32') {
      this.spawnLines('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('gpu-monitor.ps1')], (line) => {
        const d = JSON.parse(line);
        this.gpu.util = d.gpu;
        if (d.vramUsed && !this.gpu.fromNvidia) this.gpu.vramUsed = d.vramUsed;
      });
    }
    // nvidia-smi aporta temperatura, consumo y VRAM exacta cuando existe.
    execFile('nvidia-smi', ['-L'], { windowsHide: true }, (err) => {
      if (err || !this.timer) return;
      this.spawnLines('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,clocks.gr', '--format=csv,noheader,nounits', '-l', '1'], (line) => {
        const [util, temp, used, total, power, clock] = line.split(',').map((x) => parseFloat(x));
        Object.assign(this.gpu, { fromNvidia: true, utilNv: util, temp, vramUsed: used * 1048576, power, clock });
        this.vramTotal = total * 1048576;
      });
    });

    this.timer = setInterval(async () => {
      let load, mem;
      try {
        [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
      } catch {
        return; // se omite esta muestra; la siguiente vuelve a intentarlo
      }
      const cores = load.cpus.map((c) => c.load);
      const gpuUtil = this.gpu.fromNvidia ? this.gpu.utilNv : this.gpu.util;
      onSample({
        t: Date.now(),
        cpu: load.currentLoad,
        cpuMaxCore: Math.max(...cores),
        cores,
        ram: (mem.active / mem.total) * 100,
        ramUsedGb: mem.active / 1024 ** 3,
        gpu: typeof gpuUtil === 'number' ? gpuUtil : null,
        vram: this.gpu.vramUsed && this.vramTotal ? (this.gpu.vramUsed / this.vramTotal) * 100 : null,
        vramUsedGb: this.gpu.vramUsed ? this.gpu.vramUsed / 1024 ** 3 : null,
        gpuTemp: this.gpu.temp ?? null,
        gpuPower: this.gpu.power ?? null,
        gpuClock: this.gpu.clock ?? null,
      });
    }, 1000);
  }

  spawnLines(cmd, args, onLine) {
    const p = spawn(cmd, args, { windowsHide: true });
    p.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', (l) => {
      try {
        if (l.trim()) onLine(l.trim());
      } catch {
        /* línea incompleta */
      }
    });
    this.procs.push(p);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.procs.forEach((p) => p.kill());
    this.procs = [];
    this.gpu = {};
  }
}

module.exports = { LiveMonitor };
