// Genera un reporte HTML autónomo para guardar o compartir.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const COLORS = { critical: '#ff4d6d', warning: '#ffb547', tip: '#4da3ff', ok: '#2ee6a0' };
const LABELS = { critical: 'Crítico', warning: 'Advertencia', tip: 'Consejo', ok: 'Correcto' };

export function buildReport(profile, report) {
  const c = report.components;
  const rows = [
    ['Procesador', c.cpu.name],
    ['Placa madre', `${profile.board.manufacturer} ${profile.board.model}${c.board.chipset ? ` (chipset ${c.board.chipset.id})` : ''}`],
    ['Tarjeta de video', c.gpu ? `${c.gpu.match?.name || c.gpu.name} · ${c.gpu.vramGb} GB` : '—'],
    ['Memoria RAM', `${c.ram.totalGb} GB ${c.ram.type || ''} · ${c.ram.modules} módulo(s) · ${c.ram.configured || '?'} MT/s`],
    ['Disco del sistema', c.storage.system ? `${c.storage.system.name} (${c.storage.system.type} ${c.storage.system.bus})` : '—'],
    ['Sistema operativo', `${profile.os.distro} ${profile.os.release}`],
  ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte HardScope</title>
<style>
body{margin:0;background:#070a12;color:#e6e9f5;font:15px/1.55 'Segoe UI',system-ui,sans-serif;padding:32px 16px}
main{max-width:860px;margin:0 auto}h1{margin:0 0 4px}.muted{color:#8b93ad}
.score{display:inline-block;font-size:44px;font-weight:700;background:linear-gradient(90deg,#22d3ee,#8b5cf6);-webkit-background-clip:text;color:transparent}
table{width:100%;border-collapse:collapse;margin:18px 0 28px}td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)}td:first-child{color:#8b93ad;width:200px}
.f{border:1px solid rgba(255,255,255,.08);border-left:4px solid;border-radius:12px;padding:14px 18px;margin-bottom:12px;background:rgba(255,255,255,.03)}
.f b.k{font-size:11px;letter-spacing:.1em;text-transform:uppercase}.f h3{margin:4px 0}.f p{margin:4px 0;color:#c3c9de}
</style></head><body><main>
<h1>Reporte de HardScope</h1>
<div class="muted">${esc(profile.os.hostname)} · ${new Date(profile.collectedAt).toLocaleString()} · ${esc(report.settings.usage)} a ${esc(report.settings.resolution)}</div>
<p><span class="score">${report.health}/100</span><br><span class="muted">Puntaje de salud del equipo</span></p>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>Diagnóstico</h2>
${report.findings
  .map((f) => `<div class="f" style="border-left-color:${COLORS[f.severity]}"><b class="k" style="color:${COLORS[f.severity]}">${LABELS[f.severity]}</b><h3>${esc(f.title)}</h3><p>${esc(f.detail)}</p>${f.action ? `<p><b>Qué hacer:</b> ${esc(f.action)}</p>` : ''}</div>`)
  .join('')}
<p class="muted" style="margin-top:30px">Generado por HardScope. Los puntajes de rendimiento son estimaciones.</p>
</main></body></html>`;
}
