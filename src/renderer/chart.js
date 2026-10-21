// Gráfico de líneas minimalista en canvas (sin dependencias) para el monitor en vivo.
export class LineChart {
  constructor(canvas, series, capacity = 60) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = series; // [{ key, color }]
    this.capacity = capacity;
    this.data = [];
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  push(sample) {
    this.data.push(sample);
    if (this.data.length > this.capacity) this.data.shift();
    this.draw();
  }

  clear() {
    this.data = [];
    this.draw();
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 34, padB = 18, padT = 6;
    const ch = h - padB - padT;
    const cw = w - padL;
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(139,147,173,0.8)';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (const v of [0, 25, 50, 75, 100]) {
      const y = padT + ch - (v / 100) * ch;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(`${v}%`, 0, y + 4);
    }
    ctx.fillText('-60 s', padL, h - 2);
    ctx.fillText('ahora', w - 34, h - 2);

    const step = cw / (this.capacity - 1);
    const offset = this.capacity - this.data.length;
    for (const s of this.series) {
      const pts = this.data
        .map((d, i) => (typeof d[s.key] === 'number' ? [padL + (i + offset) * step, padT + ch - (Math.min(100, d[s.key]) / 100) * ch] : null))
        .filter(Boolean);
      if (pts.length < 2) continue;
      const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
      grad.addColorStop(0, s.color + '33');
      grad.addColorStop(1, s.color + '00');
      ctx.beginPath();
      ctx.moveTo(pts[0][0], padT + ch);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(pts.at(-1)[0], padT + ch);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
}
