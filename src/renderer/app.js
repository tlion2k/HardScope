import { LineChart } from './chart.js';
import { buildReport } from './report.js';

const api = window.hardscope;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gb = (bytes, d = 0) => (bytes ? `${(bytes / 1024 ** 3).toFixed(d)} GB` : '—');

const SEV = {
  critical: { label: 'Crítico', simple: 'Importante', icon: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM15 9l-6 6m0-6 6 6"/>' },
  warning: { label: 'Advertencia', simple: 'Conviene revisar', icon: '<path d="M12 3 2 20h20L12 3zm0 6v5m0 3v.01"/>' },
  tip: { label: 'Consejo', simple: 'Sugerencia', icon: '<path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>' },
  ok: { label: 'Correcto', simple: 'Bien', icon: '<path d="M20 6 9 17l-5-5"/>' },
};
const COMP = {
  cpu: { label: 'Procesador', icon: '<path d="M6 6h12v12H6zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M9.5 9.5h5v5h-5z"/>' },
  board: { label: 'Placa madre', icon: '<path d="M3 3h18v18H3zM7 7h4v4H7zm7 0h3m-3 3h3M7 15h10M7 18h6"/>' },
  gpu: { label: 'Tarjeta de video', icon: '<path d="M2 7h20v10H2zM6 17v3m4-3v3M7 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0m7-2h4m-4 3h4"/>' },
  ram: { label: 'Memoria RAM', icon: '<path d="M2 7h20v9H2zM6 16v3m4-3v3m4-3v3m4-3v3M6 10v3m4-3v3m4-3v3m4-3v3"/>' },
  storage: { label: 'Almacenamiento', icon: '<path d="M4 4h16v16H4zM8 16h.01M12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' },
  psu: { label: 'Fuente de poder', icon: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>' },
  system: { label: 'Sistema', icon: '<path d="M3 4h18v12H3zM8 20h8m-4-4v4"/>' },
};
const svg = (path) => `<svg viewBox="0 0 24 24">${path}</svg>`;
// Vista Simple (lenguaje cotidiano) o Developer (valores, umbrales y origen de los datos).
const isDev = () => state.settings.view === 'developer';
const sevLabel = (s) => (isDev() ? SEV[s].label : SEV[s].simple);

const state = {
  settings: loadSettings(),
  profile: null,
  report: null,
  filter: 'all',
  live: false,
  unsub: null,
  chart: null,
  profiles: { active: null, profiles: [] }, // perfiles de preferencias
  brands: null,
  editing: null, // perfil en edición
};

function loadSettings() {
  try {
    return { usage: 'gaming', resolution: '1440p', view: 'simple', ...JSON.parse(localStorage.getItem('hs-settings') || '{}') };
  } catch {
    return { usage: 'gaming', resolution: '1440p', view: 'simple' };
  }
}
function saveSettings() {
  try {
    localStorage.setItem('hs-settings', JSON.stringify(state.settings));
  } catch {
    /* sin almacenamiento */
  }
}

// ---------------- Navegación y barra ----------------
function go(page) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const standalone = page === 'about' || page === 'profiles';
  const ready = !!state.report || standalone;
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', ready && p.id === `page-${page}`));
  $('#loading').classList.toggle('hidden', standalone);
  if (page !== 'live' && state.live) stopLive();
}
document.querySelector('.content').addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]');
  if (b) go(b.dataset.goto);
  const g = e.target.closest('[data-gpu]');
  if (g) pickGpu(g.dataset.gpu);
});
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-page]');
  if (b) go(b.dataset.page);
});

function bindSeg(id, key) {
  const el = $(id);
  el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings[key]));
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.settings[key] = b.dataset.v;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    saveSettings();
    if (state.profile) {
      applyReanalysis(await api.reanalyze(apiSettings()));
    }
  });
}
bindSeg('#usageSeg', 'usage');
bindSeg('#resSeg', 'resolution');

// Cambiar de vista no recalcula nada: vuelve a dibujar los mismos resultados con otro nivel de detalle.
function applyView() {
  document.body.classList.toggle('developer', isDev());
  document.body.classList.toggle('simple', !isDev());
  $('#viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.view));
}
$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.v === state.settings.view) return;
  state.settings.view = b.dataset.v;
  saveSettings();
  applyView();
  stopLive();
  if (state.report) apply({ profile: state.profile, report: state.report });
  flash(isDev() ? 'Vista Developer: valores, umbrales y origen de los datos' : 'Vista Simple');
});
applyView();

$('#scanBtn').addEventListener('click', scan);
$('#retryBtn').addEventListener('click', scan);
$('#exportBtn').addEventListener('click', async () => {
  const path = await api.exportReport(buildReport(state.profile, state.report, { includeHost: !!state.settings.includeHost }));
  if (path) flash(`Reporte guardado`);
});

function flash(text) {
  const el = $('#titleStatus');
  el.innerHTML = `<span class="dot"></span>${esc(text)}`;
}

// ---------------- Escaneo ----------------
async function scan() {
  stopLive();
  $('#scanBtn').disabled = true;
  $('#exportBtn').disabled = true;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  $('#loading').classList.add('active');
  $('#loading').classList.remove('failed');
  $('#loadingTitle').textContent = 'Analizando tu equipo…';
  const steps = ['Leyendo procesador y placa madre', 'Midiendo el enlace PCIe de la tarjeta de video', 'Revisando módulos de memoria y perfiles XMP', 'Analizando discos y plan de energía', 'Buscando cuellos de botella'];
  let i = 0;
  const t = setInterval(() => ($('#loadingStep').textContent = steps[++i % steps.length]), 1100);
  try {
    const res = await api.scan(apiSettings());
    if (res?.error) throw new Error(res.error);
    apply(res);
    const missing = res.profile.issues?.length;
    flash(missing ? `Análisis con ${missing} dato(s) sin leer · ${new Date().toLocaleTimeString()}` : `Análisis completo · ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    clearInterval(t);
    $('#loading').classList.add('failed');
    $('#loadingTitle').textContent = 'No se pudo completar el análisis';
    $('#loadingStep').textContent = err.message;
    return;
  } finally {
    clearInterval(t);
    $('#scanBtn').disabled = false;
  }
  $('#loading').classList.remove('active');
  go(document.querySelector('#nav button.active')?.dataset.page || 'overview');
}

function applyReanalysis(res) {
  if (res?.error) flash(res.error);
  else if (res) apply(res);
}

function apply({ profile, report }) {
  state.profile = profile;
  state.report = report;
  $('#exportBtn').disabled = false;
  const badge = $('#navBadge');
  const n = report.counts.critical || report.counts.warning;
  badge.textContent = n || '';
  badge.classList.toggle('warn', !report.counts.critical);
  renderOverview();
  renderFindings();
  renderBalance();
  renderUpgrade();
  renderProfiles();
  renderLive();
  renderComponents();
}

// ---------------- Resumen ----------------
// Resumen: sólo los componentes y el porcentaje de compatibilidad. El detalle vive en cada sección.
function renderOverview() {
  const r = state.report;
  const c = r.components;
  const p = state.profile;
  const sev = r.health >= 80 ? 'ok' : r.health >= 55 ? 'warning' : 'critical';
  const label = r.health >= 90 ? 'Muy bien' : r.health >= 80 ? 'Bien' : r.health >= 65 ? 'Con mejoras posibles' : r.health >= 45 ? 'Con varios avisos' : 'Con avisos importantes';
  const w = r.healthWeights;
  const missing = r.dataIssues.length;
  const circ = 2 * Math.PI * 80;

  const rows = [
    { k: 'cpu', model: c.cpu.name, spec: `${p.cpu.physicalCores} núcleos · ${p.cpu.cores} hilos`, dev: `Índice ${c.cpu.effScore} a ${r.settings.resolution}${c.cpu.estimated ? ' · estimado por núcleos y frecuencia' : ''}` },
    { k: 'board', model: `${c.board.manufacturer || ''} ${c.board.model || ''}`.trim(), spec: c.board.chipset ? `Chipset ${c.board.chipset.id} · ${c.board.platform?.socket}` : '', dev: c.board.platform ? `Índice plataforma ${c.board.platform.effCeiling} · ${c.board.platform.key} · slot PCIe ${c.board.chipset?.gpuPcie ?? '?'}.0` : 'Plataforma no identificada' },
    { k: 'gpu', model: c.gpu?.match?.name || c.gpu?.name || 'Sin tarjeta de video', spec: c.gpu?.vramGb ? `${c.gpu.vramGb} GB de VRAM` : '', dev: c.gpu?.match ? `Índice ${c.gpu.score} · id «${c.gpu.match.id}»${r.balance.pcie.curWidth ? ` · enlace x${r.balance.pcie.curWidth}` : ''}` : 'No está en la base de datos' },
    { k: 'ram', model: `${c.ram.totalGb} GB ${c.ram.type || ''}`.trim(), spec: `${c.ram.modules} módulo(s) · ${c.ram.configured || '?'} MT/s`, dev: `Canal ${c.ram.channel} · nominal ${c.ram.ratedSpeed || '?'} MT/s · ${c.ram.slots ?? '?'} ranuras` },
    { k: 'storage', model: c.storage.system?.name || 'Disco del sistema', spec: c.storage.system ? `${c.storage.system.type || ''} ${c.storage.system.bus || ''}`.trim() : '', dev: c.storage.freePct != null ? `${c.storage.freePct} % libre en C:` : '' },
  ];

  $('#page-overview').innerHTML = `
    <div class="page-head"><h1>Resumen del equipo</h1><p>${esc(p.system.manufacturer)} ${esc(p.system.model)}${r.laptop ? ' · equipo portátil' : ''} · ${esc(p.os.distro)}</p></div>
    <div class="ov">
      <div class="card health sev-${sev}">
        <div class="gauge">
          <svg viewBox="0 0 190 190"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="var(--c)"/></linearGradient></defs>
            <circle class="track" cx="95" cy="95" r="80"/><circle class="bar" cx="95" cy="95" r="80" stroke="url(#gg)" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" data-target="${circ * (1 - r.health / 100)}"/></svg>
          <div class="val"><b class="num">${r.health}</b><small>de 100</small></div>
        </div>
        <div class="label">Índice del equipo</div>
        <div class="tone ov-verdict">${label}</div>
        ${isDev() ? `<p class="ov-how num">100 − (${r.counts.critical}×${w.critical} + ${r.counts.warning}×${w.warning} + ${r.counts.tip}×${w.tip}) = ${r.health}<br>Los avisos de datos no reconocidos no restan. Mínimo 5.</p>` : '<p class="ov-how">Resumen orientativo de los avisos de tu equipo, no una medición de rendimiento.</p>'}
        ${missing ? `<button class="ov-missing" data-goto="findings">${svg(SEV.warning.icon)}${missing} dato(s) no se pudieron leer</button>` : ''}
      </div>
      <div class="card ov-list">
        ${rows
          .map(
            (x) => `<div class="ov-row">
              <div class="ic">${svg(COMP[x.k].icon)}</div>
              <div class="ov-kind">${COMP[x.k].label}</div>
              <div class="ov-model"><b>${esc(x.model)}</b>${x.spec ? `<small>${esc(x.spec)}</small>` : ''}${x.dev ? `<small class="dev-only ov-dev">${esc(x.dev)}</small>` : ''}</div>
            </div>`
          )
          .join('')}
      </div>
    </div>`;

  requestAnimationFrame(() => {
    const bar = $('#page-overview .gauge .bar');
    if (bar) bar.style.strokeDashoffset = bar.dataset.target;
  });
}

const labelUsage = () => ({ gaming: 'juegos', creation: 'creación de contenido', office: 'oficina' })[state.report.settings.usage];

// ---------------- Diagnóstico ----------------
function findingHtml(f) {
  const dev = isDev();
  const title = dev ? f.title : f.plain?.title || f.title;
  const text = dev ? f.detail : f.plain?.text || f.detail;
  const action = dev ? f.action : f.plain?.action || f.action;
  return `<article class="finding sev-${f.severity}">
    <div class="sic">${svg(SEV[f.severity].icon)}</div>
    <div>
      <div class="meta"><span>${sevLabel(f.severity)}</span><span>${COMP[f.component].label}</span>${dev && f.id ? `<span class="fid">${esc(f.id)}</span>` : ''}</div>
      <h4>${esc(title)}</h4>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action ? `<div class="todo">${svg('<path d="M5 12h14m-6-6 6 6-6 6"/>')}<div><b>Qué hacer:</b> ${esc(action)}</div></div>` : ''}
      ${checksHtml(f.checks)}
      ${dev ? evidenceHtml(f.evidence) : f.detail && f.plain?.text ? `<details class="tech"><summary>Ver explicación técnica</summary><p>${esc(f.detail)}</p></details>` : ''}
    </div>
  </article>`;
}

// Vista Developer: los valores y umbrales que llevaron a la conclusión.
function evidenceHtml(ev) {
  if (!ev?.length) return '';
  return `<div class="evidence"><b>Evidencia</b><dl>${ev.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
}

// En Simple lo que está bien queda plegado para no distraer.
function findingsList(list) {
  if (!list.length) return '<div class="empty">Nada que mostrar aquí.</div>';
  if (isDev()) return list.map(findingHtml).join('');
  const todo = list.filter((f) => f.severity !== 'ok');
  const good = list.filter((f) => f.severity === 'ok');
  return (
    (todo.length ? todo.map(findingHtml).join('') : '<div class="empty">No hay nada que revisar. 👍</div>') +
    (good.length ? `<details class="good-list"><summary>${svg(SEV.ok.icon)}Lo que está bien (${good.length})</summary>${good.map(findingHtml).join('')}</details>` : '')
  );
}

// "Verifica antes de comprar": lo que HardScope no puede comprobar por sí solo.
function checksHtml(checks) {
  if (!checks?.length) return '';
  return `<details class="checks"><summary>${svg('<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>')}Verifica antes de comprar (${checks.length})</summary><ul>${checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>`;
}

function dataIssuesHtml(issues) {
  if (!issues?.length) return '';
  return `<div class="data-issues">${svg(SEV.warning.icon)}<div><b>Algunos datos no se pudieron leer</b><ul>${issues.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul><small>Las conclusiones que dependen de esos datos pueden faltar o ser menos precisas. Prueba «Analizar de nuevo».</small></div></div>`;
}

function renderFindings() {
  const r = state.report;
  const comps = ['all', ...Object.keys(COMP).filter((k) => r.findings.some((f) => f.component === k))];
  if (!comps.includes(state.filter)) state.filter = 'all';
  const list = r.findings.filter((f) => state.filter === 'all' || f.component === state.filter);
  $('#page-findings').innerHTML = `
    <div class="page-head">${isDev() ? `<h1>Diagnóstico y consejos</h1><p><span class="tone sev-critical">● Crítico</span> · <span class="tone sev-warning">● Advertencia</span> · <span class="tone sev-tip">● Consejo</span> · <span class="tone sev-ok">● Correcto</span>. Cada hallazgo muestra su evidencia: índices, umbrales y origen de los datos.</p>` : `<h1>Qué revisar en tu equipo</h1><p><span class="tone sev-critical">● Importante</span> · <span class="tone sev-warning">● Conviene revisar</span> · <span class="tone sev-tip">● Sugerencia</span> · <span class="tone sev-ok">● Bien</span>. Las comparaciones son estimaciones, no mediciones.</p>`}</div>
    ${dataIssuesHtml(r.dataIssues)}
    <div class="filters">${comps.map((k) => `<button data-f="${k}" class="${state.filter === k ? 'on' : ''}">${k === 'all' ? 'Todos' : COMP[k].label} <span class="num">${k === 'all' ? r.findings.length : r.findings.filter((f) => f.component === k).length}</span></button>`).join('')}</div>
    ${findingsList(list)}`;
  $('#page-findings .filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.filter = b.dataset.f;
    renderFindings();
  });
}

// ---------------- Placa vs GPU ----------------
// Vista Simple: qué tienes y la conclusión en una frase, sin índices ni PCIe.
function simpleBalance(r) {
  const { board, gpu } = r.components;
  const cf = r.findings.find((x) => ['cpu-bottleneck', 'gpu-weak-vs-cpu', 'cpu-gpu-balanced'].includes(x.id));
  return `<div class="card simple-only simple-balance">
    <div class="sb-row"><div class="ic">${svg(COMP.board.icon)}</div><div><small>Placa madre</small><b>${esc(`${board.manufacturer || ''} ${board.model || ''}`)}</b></div></div>
    <div class="sb-row"><div class="ic">${svg(COMP.gpu.icon)}</div><div><small>Tarjeta de video</small><b>${esc(gpu?.match?.name || gpu?.name || 'Sin tarjeta dedicada')}</b></div></div>
    ${cf ? `<p><b>${esc(cf.plain?.title || cf.title)}.</b> ${esc(cf.plain?.text || '')}</p>` : ''}
    <p class="muted" style="font-size:12.5px">Cambia a la vista Developer para ver índices, PCIe y la escala de comparación.</p>
  </div>`;
}
function renderBalance() {
  const r = state.report;
  const { board, gpu, cpu } = r.components;
  const { boardVsGpu: bvg, cpuVsGpu: cvg, pcie } = r.balance;
  const f = r.findings.find((x) => ['board-limits-gpu', 'board-superior', 'board-gpu-balanced'].includes(x.id));
  const V = {
    gpu: { sev: f?.severity || 'warning', title: f?.title || 'La plataforma probablemente no aprovecha toda tu tarjeta de video', icon: '<path d="M12 3 2 20h20L12 3zm0 6v5m0 3v.01"/>' },
    board: { sev: f?.severity || 'tip', title: 'Tu placa admite tarjetas de video bastante más potentes', icon: '<path d="M12 19V5m-6 6 6-6 6 6"/>' },
    balanced: { sev: 'ok', title: 'Placa y tarjeta de video están bien emparejadas', icon: SEV.ok.icon },
    unknown: { sev: 'tip', title: 'No hay datos suficientes para comparar', icon: SEV.tip.icon },
    laptop: { sev: 'tip', title: 'Equipo portátil: placa y tarjeta vienen integradas y no se cambian por separado', icon: SEV.tip.icon },
  }[bvg.verdict];

  const max = Math.max(bvg.ceiling || 0, bvg.gpuScore || 0, cvg.cpuScore || 0, 40) * 1.15;
  const pos = (v) => `${Math.min(100, (v / max) * 100)}%`;
  const lanesUsed = pcie.curWidth || pcie.lanes || 0;
  const recs = r.findings.filter((x) => ['board', 'gpu', 'cpu'].includes(x.component) && x.severity !== 'ok' && x !== f);

  $('#page-balance').innerHTML = `
    <div class="page-head"><h1>Placa madre vs tarjeta de video</h1><p>${isDev() ? 'Compara el índice estimado de la plataforma (socket, mejor procesador compatible y PCIe) con el de tu tarjeta de video. Son índices de referencia, no mediciones: el resultado real depende del juego y la resolución.' : 'Si tu placa y tu tarjeta de video están bien emparejadas, o si una se queda corta para la otra.'}</p></div>
    <div class="verdict tone sev-${V.sev}" style="border-color:color-mix(in srgb,var(--c) 40%,transparent);background:color-mix(in srgb,var(--c) 7%,transparent)">
      <div class="big">${svg(V.icon)}</div>
      <div><h2>${esc(isDev() ? V.title : f?.plain?.title || V.title)}</h2><p>${esc(isDev() ? f?.detail || '' : f?.plain?.text || f?.detail || '')}</p>${f?.action ? `<p style="margin-top:8px;color:var(--text)"><b>Qué hacer:</b> ${esc(isDev() ? f.action : f.plain?.action || f.action)}</p>` : ''}${checksHtml(f?.checks)}${isDev() ? evidenceHtml(f?.evidence) : ''}</div>
    </div>
    ${simpleBalance(r)}
    <div class="dev-only">
    <div class="vs">
      <div class="card side">
        <h3>${svg(COMP.board.icon)} Placa / plataforma</h3>
        <h2>${esc(board.manufacturer)} ${esc(board.model)}</h2>
        <div class="sub">${board.chipset ? `Chipset ${esc(board.chipset.id)} · gama ${({ entry: 'de entrada', mainstream: 'media', enthusiast: 'alta' })[board.chipset.segment]}` : 'Chipset no identificado'}</div>
        <dl class="kv">
          <dt>Socket</dt><dd>${esc(board.platform?.socket || '—')}</dd>
          <dt>Slot gráfico</dt><dd>${board.chipset ? `PCIe ${board.chipset.gpuPcie}.0 x16` : '—'}</dd>
          <dt>Memoria</dt><dd>${esc(board.platform?.mem || '—')}</dd>
          <dt>Mejor CPU compatible</dt><dd>${esc(board.platform?.bestCpus?.at(-1) || '—')}</dd>
          <dt>Índice de la plataforma (${esc(r.settings.resolution)})</dt><dd class="num">${bvg.ceiling ?? '—'}</dd>
        </dl>
      </div>
      <div class="mid"><small>relación</small><b class="num">${bvg.ratio != null ? `${Math.round(bvg.ratio * 100)}%` : '—'}</b><small>GPU / plataforma</small></div>
      <div class="card side">
        <h3>${svg(COMP.gpu.icon)} Tarjeta de video</h3>
        <h2>${esc(gpu?.match?.name || gpu?.name || 'Sin GPU')}</h2>
        <div class="sub">${gpu?.integrated ? 'Gráficos integrados' : gpu?.match ? `Generación ${gpu.match.year}` : 'Modelo no reconocido'}</div>
        <dl class="kv">
          <dt>Índice estimado</dt><dd class="num">${gpu?.score ?? '—'}</dd>
          <dt>Interfaz</dt><dd>${pcie.gpuGen ? `PCIe ${pcie.gpuGen}.0 x${pcie.lanes}` : '—'}</dd>
          <dt>Enlace actual</dt><dd>${pcie.curWidth ? `x${pcie.curWidth}${pcie.curGen ? ` · Gen ${pcie.curGen}` : ''}` : '—'}</dd>
          <dt>VRAM</dt><dd>${gpu?.vramGb ? `${gpu.vramGb} GB` : '—'}</dd>
          <dt>Driver</dt><dd>${esc(gpu?.driverVersion || '—')}</dd>
        </dl>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Índices estimados (RTX 4090 = 100)</h3>
      <div class="scale">
        <div class="rail"></div>
        ${bvg.gpuScore != null ? `<div class="fill" style="left:0;width:${pos(bvg.gpuScore)}"></div>` : ''}
        ${bvg.ceiling ? `<div class="mark" style="left:${pos(bvg.ceiling)};color:var(--tip)">Plataforma ${bvg.ceiling}<i style="background:var(--tip)"></i></div>` : ''}
        ${bvg.gpuScore != null ? `<div class="mark" style="left:${pos(bvg.gpuScore)};color:var(--cyan)">GPU ${bvg.gpuScore}<i style="background:var(--cyan)"></i></div>` : ''}
        <div class="mark below" style="left:${pos(cvg.cpuScore)};color:var(--violet)">CPU ${cvg.cpuScore}<i style="background:var(--violet)"></i></div>
      </div>
      <p style="color:var(--muted);margin:26px 0 0;font-size:12.5px">Si la GPU queda claramente a la derecha de la plataforma o del procesador, es probable que no rinda todo su potencial en juegos que dependen del procesador. Si queda muy a la izquierda, la placa admite una tarjeta bastante mejor.</p>
    </div>
    <div class="two">
      <div class="card">
        <h3>Carriles PCIe del slot gráfico</h3>
        <div class="lanes">${Array.from({ length: 16 }, (_, i) => `<i class="${i < lanesUsed ? 'on' : 'cap'}"></i>`).join('')}</div>
        <div class="lanes-legend"><span style="--bg-l:linear-gradient(var(--cyan),var(--violet))">Usados por la GPU (x${lanesUsed || '?'})</span><span style="--bg-l:rgba(77,163,255,.35)">Disponibles en el slot x16</span></div>
        <dl class="kv">
          <dt>Placa</dt><dd>${pcie.slotGen ? `PCIe ${pcie.slotGen}.0` : '—'}</dd>
          <dt>Tarjeta</dt><dd>${pcie.gpuGen ? `PCIe ${pcie.gpuGen}.0 x${pcie.lanes}` : '—'}</dd>
          <dt>Enlace efectivo</dt><dd>${pcie.linkGen ? `PCIe ${pcie.linkGen}.0 x${lanesUsed}` : '—'}</dd>
          <dt>Ancho de banda</dt><dd class="num">${pcie.effBW ? `${pcie.effBW} / ${pcie.fullBW} GB/s` : '—'}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>Procesador vs tarjeta de video</h3>
        <h2 style="font-size:17px">${esc(cpu.name)}</h2>
        <div class="scale" style="margin-top:22px">
          <div class="rail" style="background:linear-gradient(90deg,var(--ok),var(--warning) 60%,var(--critical))"></div>
          <div class="mark" style="left:${Math.min(98, cvg.bottleneckPct * 1.6 + 2)}%;color:var(--text)">${cvg.verdict === 'cpu' ? `El procesador limitaría ≈ ${cvg.bottleneckPct} % (índice)` : cvg.verdict === 'gpu' ? 'La GPU es el límite probable' : 'Sin límite claro (estimado)'}<i style="background:#fff"></i></div>
        </div>
        <dl class="kv" style="margin-top:28px">
          <dt>Índice CPU (${esc(r.settings.resolution)})</dt><dd class="num">${cvg.cpuScore}</dd>
          <dt>Índice GPU</dt><dd class="num">${cvg.gpuScore ?? '—'}</dd>
          <dt>Consejo</dt><dd>${cvg.verdict === 'cpu' ? 'Confírmalo con el Monitor en vivo' : cvg.verdict === 'gpu' ? 'Mejorar la tarjeta de video' : 'Mantener'}</dd>
        </dl>
      </div>
    </div>
    </div>
    ${recs.length ? `<div class="page-head" style="margin-top:24px"><h1 style="font-size:20px">${isDev() ? 'Otros hallazgos de placa, GPU y CPU' : 'Otras cosas para revisar'}</h1></div>${recs.map(findingHtml).join('')}` : ''}`;
}

// ---------------- Próxima mejora ----------------
const STEP_ICON = { gpu: COMP.gpu.icon, cpu: COMP.cpu.icon, platform: COMP.board.icon };
const LIMITER = { cpu: 'el procesador', gpu: 'la tarjeta de video', board: 'la placa' };

const afterBadge = (snap) =>
  snap.balanced
    ? `<span class="chip sev-ok tone">${svg(SEV.ok.icon)}Equilibrado (estimado)</span>`
    : `<span class="chip sev-warning tone">${svg(SEV.warning.icon)}Luego limitará ${LIMITER[snap.limiter]}</span>`;

// Modelo · versión Marca → modelo como título y la versión debajo.
const pickHtml = (pick, tag) => {
  const [main, ...rest] = pick.split(' · ');
  return `<${tag}>${esc(main)}</${tag}>${rest.length ? `<div class="pick-sub">${esc(rest.join(' · '))}</div>` : ''}`;
};

const stepNotes = (s) =>
  [
    s.prefNote && `<p class="note pref">${svg('<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0"/>')}<span>${esc(s.prefNote)}</span></p>`,
    s.psu && `<p class="note">${svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>')}<span>${esc(s.psu)}</span></p>`,
    s.note && `<p class="note">${svg(SEV.tip.icon)}<span>${esc(s.note)}</span></p>`,
  ]
    .filter(Boolean)
    .join('');

const SIMPLE_ROWS = new Set(['Tarjeta de video', 'Procesador', 'Memoria de video (VRAM)', 'Placa madre', 'Plataforma', 'Memoria RAM', 'Fuente recomendada', 'Índice de rendimiento estimado', 'Equilibrio']);

function simpleRows(rows) {
  return rows
    .filter((row) => SIMPLE_ROWS.has(row.label))
    .map((row) => (row.label === 'Índice de rendimiento estimado' ? { ...row, label: 'Rendimiento en juegos (estimado)', before: 'Actual', after: row.diff === 'Base' ? 'Similar' : 'Mayor' } : row));
}

function simpleReason(s) {
  if (s.kind === 'gpu') return 'Es el cambio que más se notaría en tu equipo, sin que otra pieza quede por debajo.';
  if (s.kind === 'cpu') return 'Tu procesador es lo que más limita ahora. Este modelo encaja en tu placa actual.';
  return 'Tu placa ya no admite un procesador mejor, así que hay que cambiar placa, procesador y memoria juntos.';
}

function stepEvidence(s) {
  const fmt = (x) => `CPU ${x.cpu} · GPU ${x.gpu} · plataforma ${x.ceiling ?? '—'} → mínimo ${x.perf}`;
  return [
    ['Índices antes', fmt(s.before)],
    ['Índices después', fmt(s.after)],
    ['Ganancia', `${s.gainPct} % (mínimo después / mínimo antes)`],
    ['Nivel de gasto', state.report.upgrades.budget],
    ['Criterio GPU', 'índice ≥ actual ×1,25 y ≤ índice del procesador/plataforma ×1,08; año ≥ 2022'],
    ['Equilibrio', 'GPU/CPU entre 0,5 y 1,1 y GPU ≤ plataforma ×1,1'],
  ];
}

function compareTable(rows) {
  return `<table class="cmp">
    <thead><tr><th></th><th>Ahora</th><th>Con la mejora</th><th>Diferencia</th></tr></thead>
    <tbody>${rows
      .map((r) => {
        const up = /^\+/.test(r.diff || '');
        return `<tr class="${r.highlight ? 'hl' : ''}"><td>${esc(r.label)}</td><td>${esc(r.before)}</td><td class="${r.good ? 'good' : ''}"><b>${esc(r.after)}</b></td><td class="${up ? 'up' : r.diff === 'Revisa tu fuente' ? 'warn' : 'muted'}">${esc(r.diff || '')}</td></tr>`;
      })
      .join('')}</tbody>
  </table>`;
}

function renderUpgrade() {
  const u = state.report.upgrades;
  const next = u.steps[0];

  const hero = next
    ? `<div class="up-main">
        <div class="kicker">Siguiente actualización recomendada · ${esc(next.title)}</div>
        <div class="up-row">
          <div class="up-pick"><div class="ic">${svg(STEP_ICON[next.kind])}</div><div>${pickHtml(next.pick, 'h2')}</div></div>
          <div class="up-gain">${next.gainPct < 5 ? '<b class="num">Base</b><span>prepara el siguiente paso</span>' : `<b class="num">+${next.gainPct}%</b><span>${isDev() ? 'índice de rendimiento<br>estimado' : 'más rendimiento<br>(estimado)'}</span>`}</div>
        </div>
        <p>${esc(isDev() ? next.reason : simpleReason(next))}</p>
        ${next.alternatives.length ? `<div class="alts"><small>Otras alternativas de rendimiento:</small>${next.alternatives.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>` : ''}
        ${stepNotes(next)}
        ${checksHtml(next.checks)}
        ${isDev() ? evidenceHtml(stepEvidence(next)) : ''}
      </div>
      <div class="card cmp-card"><h3>Antes y después</h3>${compareTable(isDev() ? next.compare : simpleRows(next.compare))}</div>`
    : `<div class="verdict tone sev-ok" style="border-color:color-mix(in srgb,var(--c) 40%,transparent);background:color-mix(in srgb,var(--c) 7%,transparent)"><div class="big">${svg(SEV.ok.icon)}</div><div><h2>No hay una mejora pendiente</h2><p>${esc(u.final)}</p></div></div>`;

  const road =
    u.steps.length > 1
      ? `<div class="page-head" style="margin-top:26px"><h1 style="font-size:20px">Ruta de mejora completa</h1><p>Orden recomendado para que en cada paso ningún componente frene a los demás.</p></div>
        <div class="road">${u.steps
          .map(
            (s, i) => `<div class="road-step">
              <div class="road-n num">${i + 1}</div>
              <div class="card">
                <div class="road-top"><div><small class="muted">${esc(s.title)}</small>${pickHtml(s.pick, 'h4')}</div><b class="num gain">${s.gainPct < 5 ? 'Base' : `+${s.gainPct}%`}</b></div>
                <p class="muted" style="margin:6px 0 10px">${esc(isDev() ? s.reason : simpleReason(s))}</p>
                ${stepNotes(s)}${checksHtml(s.checks)}
                <div class="road-foot">${afterBadge(s.after)}<span class="muted num dev-only">CPU ${s.after.cpu} · GPU ${s.after.gpu}${s.after.ceiling ? ` · Placa ${s.after.ceiling}` : ''}</span></div>
              </div>
            </div>`
          )
          .join('')}</div>`
      : '';

  $('#page-upgrade').innerHTML = `
    <div class="page-head"><h1>Tu próxima mejora</h1><p>${isDev() ? `Simulación por pasos con índices estimados (${labelUsage()} a ${esc(state.report.settings.resolution)}). Alternativas de rendimiento, no una lista de compra.` : 'Qué conviene cambiar para que tu equipo rinda más, sin que otra pieza quede por debajo.'}</p></div>
    ${hero}${road}
    ${u.steps.length ? `<p class="muted" style="margin-top:18px">${esc(u.final)} ${isDev() ? 'Los porcentajes son índices estimados para juegos, no FPS medidos: el resultado real depende del juego, la resolución y la configuración.' : 'El porcentaje es una estimación para juegos; el resultado real depende del juego y la configuración.'}</p>` : ''}`;
}

// ---------------- Monitor en vivo ----------------
const LIVE_STATES = {
  idle: ['tip', 'Equipo en reposo', 'Abre un juego o programa pesado y deja el monitor corriendo para ver qué componente trabaja al límite.'],
  'no-gpu-data': ['tip', 'Sin lectura de la tarjeta de video', 'Windows no está entregando el uso de la GPU, así que no se puede saber qué componente limita. Se muestran solo CPU y RAM.'],
  'gpu-bound': ['ok', 'La GPU trabaja al máximo', 'Es lo ideal en juegos: el procesador alimenta bien a la tarjeta. Para más FPS, la mejora sería la GPU.'],
  'cpu-bound': ['warning', 'Indicio: el procesador limita en este momento', 'La GPU no llega al máximo mientras un núcleo está al tope. Si el juego no tiene límite de FPS ni V-Sync, es probable que el procesador sea el límite en esta escena.'],
  'cpu-busy': ['warning', 'Procesador muy cargado', 'El CPU está cerca del 100%. Si hay tirones, cierra procesos en segundo plano.'],
  balanced: ['ok', 'Carga equilibrada', 'CPU y GPU trabajan sin que uno frene al otro.'],
};

function renderLive() {
  $('#page-live').innerHTML = `
    <div class="page-head"><h1>Monitor en vivo</h1><p>Mide el uso real mientras juegas o trabajas para detectar qué componente frena el equipo en ese momento.</p></div>
    <div class="live-head">
      <div class="live-state sev-tip tone" id="liveState" style="border-color:color-mix(in srgb,var(--c) 40%,transparent);background:color-mix(in srgb,var(--c) 7%,transparent)">
        <span class="pulse"></span><div><b id="liveTitle" style="color:var(--text)">Monitor detenido</b><div id="liveText" style="color:var(--muted);font-size:13px">Pulsa "Iniciar" y abre tu juego.</div></div>
      </div>
      <button class="btn primary" id="liveBtn">${svg('<path d="M6 4l14 8-14 8z"/>')}Iniciar</button>
    </div>
    <div class="gauges">
      ${[['cpu', 'CPU total', '%'], ['cpuMaxCore', 'Núcleo más cargado', '%'], ['gpu', 'GPU', '%'], ['ram', 'RAM', '%'], ['vram', 'VRAM', '%'], ['gpuTemp', 'Temp. GPU', '°C']]
        .map(([k, l, u]) => `<div class="lg${['cpuMaxCore', 'vram'].includes(k) ? ' dev-only' : ''}" data-k="${k}"><small>${l}</small><b class="num">—<em>${u}</em></b><div class="meter"><i style="width:0"></i></div></div>`)
        .join('')}
    </div>
    <div class="card dev-only" style="margin-bottom:16px">
      <div class="legend"><span style="--lc:#22d3ee">CPU</span><span style="--lc:#8b5cf6">GPU</span><span style="--lc:#2ee6a0">RAM</span><span style="--lc:#ffb547">VRAM</span><span style="--lc:#ff4d6d">Núcleo máx.</span></div>
      <div class="chart-wrap"><canvas id="liveChart"></canvas></div>
    </div>
    <div class="two">
      <div class="card dev-only"><h3>Carga por hilo del procesador</h3><div class="cores" id="cores"></div></div>
      <div class="card alerts"><h3>Alertas en vivo</h3><div id="liveAlerts"><div class="empty" style="padding:20px">Sin alertas</div></div></div>
    </div>`;
  state.chart = new LineChart($('#liveChart'), [
    { key: 'cpu', color: '#22d3ee' },
    { key: 'gpu', color: '#8b5cf6' },
    { key: 'ram', color: '#2ee6a0' },
    { key: 'vram', color: '#ffb547' },
    { key: 'cpuMaxCore', color: '#ff4d6d' },
  ]);
  $('#liveBtn').addEventListener('click', () => (state.live ? stopLive() : startLive()));
}

async function startLive() {
  state.live = true;
  $('#liveBtn').innerHTML = `${svg('<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>')}Detener`;
  $('#liveBtn').classList.replace('primary', 'danger');
  $('#liveTitle').textContent = 'Midiendo…';
  state.chart.clear();
  state.unsub = api.onSample(onSample);
  await api.startMonitor();
}

function stopLive() {
  if (!state.live) return;
  state.live = false;
  state.unsub?.();
  api.stopMonitor();
  const btn = $('#liveBtn');
  if (btn) {
    btn.innerHTML = `${svg('<path d="M6 4l14 8-14 8z"/>')}Iniciar`;
    btn.classList.replace('danger', 'primary');
  }
}

function onSample({ sample, diagnosis }) {
  state.chart.push(sample);
  document.querySelectorAll('#page-live .lg').forEach((el) => {
    const v = sample[el.dataset.k];
    const unit = el.dataset.k === 'gpuTemp' ? '°C' : '%';
    el.querySelector('b').innerHTML = `${typeof v === 'number' ? Math.round(v) : '—'}<em>${unit}</em>`;
    el.querySelector('.meter i').style.width = `${typeof v === 'number' ? Math.min(100, v) : 0}%`;
  });
  $('#cores').innerHTML = sample.cores.map((l, i) => `<i style="--h:${l}%" title="Hilo ${i}: ${Math.round(l)}%"></i>`).join('');
  if (!diagnosis) return;
  const [sev, title, text] = LIVE_STATES[diagnosis.state];
  const el = $('#liveState');
  el.className = `live-state tone sev-${sev}`;
  $('#liveTitle').textContent = title;
  $('#liveText').textContent = text;
  $('#liveAlerts').innerHTML = diagnosis.alerts.length
    ? diagnosis.alerts.map((a) => findingHtml({ severity: a.severity, component: a.component, title: a.text, detail: '' })).join('')
    : '<div class="empty" style="padding:20px">Sin alertas</div>';
}

// ---------------- Componentes ----------------
function gpuPicker(g) {
  if (state.report.components.gpus.length < 2) return '';
  return g.name === state.report.settings.primaryGpu
    ? '<div class="gpu-pick on">Esta es la tarjeta que se usa para el análisis</div>'
    : `<button class="btn ghost sm gpu-pick" data-gpu="${esc(g.name)}">Usar esta tarjeta para el análisis</button>`;
}

async function pickGpu(name) {
  state.settings.primaryGpu = name;
  saveSettings();
  applyReanalysis(await api.reanalyze(apiSettings()));
  flash(`Análisis con ${name}`);
}
function renderComponents() {
  const p = state.profile;
  const r = state.report;
  // Tercer valor de cada fila: true = sólo en la vista Developer.
  const table = (rows) => `<table>${rows.filter((x) => x[1] != null && x[1] !== '').map(([k, v, dev]) => `<tr class="${dev ? 'dev-only' : ''}"><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const block = (k, inner) => `<div class="card spec-card"><div class="head">${svg(COMP[k].icon)}<h3 style="margin:0">${COMP[k].label}</h3></div>${inner}</div>`;
  const ram = r.components.ram;
  $('#page-components').innerHTML = `
    <div class="page-head"><h1>Componentes detectados</h1><p>Inventario completo de tu equipo.</p></div>
    ${block('cpu', table([
      ['Modelo', r.components.cpu.name],
      ['Núcleos / hilos', `${p.cpu.physicalCores} / ${p.cpu.cores}`],
      ['Núcleos P / E', p.cpu.performanceCores && p.cpu.efficiencyCores ? `${p.cpu.performanceCores} / ${p.cpu.efficiencyCores}` : null, true],
      ['Frecuencia base', p.cpu.speed ? `${p.cpu.speed} GHz` : null],
      ['Caché L3', p.cpu.cache?.l3 ? `${Math.round(p.cpu.cache.l3 / 1024 / 1024)} MB` : null, true],
      ['Índice estimado', `${r.components.cpu.score}${r.components.cpu.estimated ? ' (aproximado)' : ''}`, true],
      ['Render medido (Blender Open Data)', r.components.cpu.blender ? `${r.components.cpu.blender.score} puntos · mediana de ${r.components.cpu.blender.n} resultados` : 'sin resultados', true],
    ]))}
    ${block('board', table([
      ['Fabricante', p.board.manufacturer],
      ['Modelo', p.board.model],
      ['Chipset', r.components.board.chipset?.id || 'No identificado'],
      ['Socket', r.components.board.platform?.socket],
      ['BIOS', `${p.bios.vendor || ''} ${p.bios.version || ''} (${p.bios.releaseDate || '—'})`, true],
      ['Ranuras de RAM', ram.slots],
      ['RAM máxima', ram.maxGb ? `${ram.maxGb} GB` : null],
    ]))}
    ${r.components.gpus.map((g) => block('gpu', gpuPicker(g) + table([
      ['Modelo', g.name],
      ['Fabricante', g.vendor],
      ['VRAM', g.vramGb ? `${g.vramGb} GB` : 'Compartida'],
      ['Tipo', g.integrated ? 'Integrada' : 'Dedicada'],
      ['Enlace PCIe actual', g.pcie?.curWidth ? `Gen ${g.pcie.curGen} x${g.pcie.curWidth}` : null, true],
      ['Enlace PCIe máximo', g.pcie?.maxWidth ? `Gen ${g.pcie.maxGen} x${g.pcie.maxWidth}` : null, true],
      ['Ensambladora', g.maker, true],
      ['Driver', g.driverVersion, true],
      ['Índice estimado', g.score, true],
      ['Origen del índice', { curated: 'catálogo revisado a mano', estimated: 'estimado con Blender Open Data (confianza baja)', specs: 'sólo especificaciones, sin índice' }[g.match?.origin] || 'no reconocida', true],
      ['Render medido (Blender Open Data)', g.match?.blender ? `${g.match.blender.score} puntos · mediana de ${g.match.blender.n} resultados (${g.match.blender.backend})` : null, true],
      ['Consumo (TDP)', g.match?.tdp ? `${g.match.tdp} W` : null, true],
    ]))).join('')}
    ${block('ram', `${table([
      ['Total', `${ram.totalGb} GB ${ram.type || ''}`],
      ['Velocidad actual', ram.configured ? `${ram.configured} MT/s` : null],
      ['Velocidad nominal (XMP/EXPO)', ram.ratedSpeed ? `${ram.ratedSpeed} MT/s` : 'No determinada', true],
      ['Canal', { dual: 'Doble canal', 'dual-probable': 'Doble canal (probable)', single: 'Canal simple' }[ram.channel] || '—'],
    ])}<table class="dev-only" style="margin-top:10px"><tr><th>Ranura</th><th>Capacidad</th><th>Velocidad</th><th>Fabricante</th><th>Número de parte</th></tr>${p.ram.modules.map((m) => `<tr><td>${esc(m.locator)}</td><td>${gb(m.size)}</td><td>${esc(m.configuredSpeed)} MT/s</td><td>${esc(m.manufacturer)}</td><td class="num">${esc(m.partNum)}</td></tr>`).join('')}</table>`)}
    ${block('storage', `<table><tr><th>Disco</th><th>Tipo</th><th>Interfaz</th><th>Capacidad</th><th></th></tr>${p.disks.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.type || '—')}</td><td>${esc(d.bus || '—')}</td><td>${gb(d.size)}</td><td>${d.isSystem ? 'Sistema' : ''}</td></tr>`).join('')}</table>`)}
    ${block('system', table([
      ['Sistema operativo', `${p.os.distro} ${p.os.release}`],
      ['Build', p.os.build, true],
      ['Tipo de equipo', `${p.system.chassis || '—'}${r.laptop ? ' (portátil)' : ''}`, true],
      ['Arquitectura', p.os.arch],
      ['Plan de energía', p.power?.name],
      ['Pantallas', p.displays.map((d) => `${d.resolutionX}×${d.resolutionY} @ ${d.refreshRate || '?'} Hz`).join(' · ')],
    ]))}
    <div class="card spec-card dev-only"><div class="head">${svg('<path d="M4 6h16M4 12h16M4 18h10"/>')}<h3 style="margin:0">Origen de los datos</h3></div>${table([
      ['Procesador', 'systeminformation (WMI Win32_Processor) · índice por generación y gama en hardware.js'],
      ['Placa y BIOS', 'WMI Win32_BaseBoard / Win32_BIOS · chipset deducido del nombre del modelo'],
      ['Tarjeta de video', 'systeminformation + Windows PnP (enlace PCIe y ensambladora por SUBSYS) · índice en gpus.json'],
      ['Memoria RAM', 'WMI Win32_PhysicalMemory (velocidad, ranura, número de parte) · nominal deducida del número de parte'],
      ['Discos', 'Get-PhysicalDisk y Get-Partition (disco del sistema)'],
      ['Base de datos', `${r.db.gpus} tarjetas de video · ${r.db.chipsets} chipsets · versión ${r.db.version} (actualizada ${r.db.updated})`],
      ['Fuente de los índices', r.db.source],
      ['Catálogo ampliado', `${r.db.extra.count} GPUs (${r.db.extra.measured} medidas en Blender) · ${r.db.extra.cpus} CPUs medidas · Blender Open Data hasta ${r.db.extra.sources?.blender?.snapshot || '—'} · open-gpu-db`],
      ['Catálogo en uso', `versión ${r.db.catalog.version ?? '—'} (${r.db.catalog.origin === 'downloaded' ? 'descargado' : 'incluido'})`],
      ['Confianza de tu GPU', r.components.gpu?.match ? `${r.components.gpu.match.conf} (${{ alta: 'contrastado con varias fuentes', media: 'estimación coherente con reseñas públicas', baja: 'pocos datos públicos o modelo reciente' }[r.components.gpu.match.conf]})` : 'sin datos'],
      ['Datos no leídos', r.dataIssues.length ? r.dataIssues.map((i) => i.text).join(' · ') : 'ninguno'],
    ])}</div>`;
}

// ---------------- Perfiles de preferencias ----------------
const BUDGETS = { economico: 'Económico', equilibrado: 'Equilibrado', maximo: 'Máximo rendimiento' };
const activeProfile = () => state.profiles.profiles.find((p) => p.id === state.profiles.active) || null;
const apiSettings = () => ({ ...state.settings, prefs: activeProfile() });

function profileSummary(p) {
  const parts = [
    p.cpuBrand && `CPU ${p.cpuBrand}`,
    p.gpuBrand && `GPU ${p.gpuBrand}${p.gpuMaker ? ` (${p.gpuMaker})` : ''}`,
    p.boardBrand && `Placa ${p.boardBrand}`,
    p.psuBrand && `Fuente ${p.psuBrand}`,
    p.ramBrand && `RAM ${p.ramBrand}`,
    p.storageBrand && `SSD ${p.storageBrand}`,
  ].filter(Boolean);
  return `${parts.join(' · ') || 'Sin marcas preferidas'} · ${BUDGETS[p.budget || 'equilibrado']}`;
}

async function initProfiles() {
  [state.profiles, state.brands] = await Promise.all([api.loadProfiles(), api.brands()]);
  applyProfileDefaults(activeProfile());
  renderProfileSelect();
  renderProfiles();
}

function renderProfileSelect() {
  const sel = $('#profileSel');
  sel.innerHTML = `<option value="">Vista global (genérica)</option>${state.profiles.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="__new">＋ Crear perfil…</option>`;
  sel.value = state.profiles.active || '';
  sel.closest('.profile-pick').classList.toggle('on', !!state.profiles.active);
}

$('#profileSel').addEventListener('change', async (e) => {
  if (e.target.value === '__new') {
    state.editing = { budget: 'equilibrado' };
    renderProfileSelect();
    renderProfiles();
    return go('profiles');
  }
  await activate(e.target.value || null);
});

// Al activar un perfil se usan su uso y resolución por defecto, si los tiene.
function applyProfileDefaults(p) {
  if (!p) return;
  for (const [key, seg] of [['usage', '#usageSeg'], ['resolution', '#resSeg']]) {
    if (!p[key]) continue;
    state.settings[key] = p[key];
    $(seg).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === p[key]));
  }
  saveSettings();
}

async function activate(id) {
  state.profiles = await api.activateProfile(id);
  applyProfileDefaults(activeProfile());
  renderProfileSelect();
  renderProfiles();
  if (state.profile) {
    applyReanalysis(await api.reanalyze(apiSettings()));
  }
  flash(id ? `Perfil «${activeProfile()?.name}» activo` : 'Vista global activa');
}

function optionList(values, current, anyLabel = 'Cualquiera') {
  return `<option value="">${anyLabel}</option>${values.map((v) => `<option ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
}
function segField(name, values, current, labels = {}) {
  return `<div class="seg" data-field="${name}">${[['', 'Cualquiera'], ...values.map((v) => [v, labels[v] || v])].map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${(current || '') === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}

function renderProfiles() {
  const b = state.brands;
  const e = state.editing;
  const active = activeProfile();
  const page = $('#page-profiles');

  if (e) {
    page.innerHTML = `
      <div class="page-head"><h1>${e.id ? 'Editar perfil' : 'Nuevo perfil'}</h1><p>Tus marcas preferidas y cuánto quieres gastar. HardScope comparará tu equipo con estas preferencias.</p></div>
      ${profileEditor(b, e)}`;
    bindEditor(b);
    return;
  }

  if (!active) {
    page.innerHTML = `
      <div class="page-head"><h1>Actual vs perfil</h1><p>Compara tu equipo con tus preferencias de marca y te dice qué cambiar.</p></div>
      <div class="card editor empty-editor">
        <div class="avatar big">${svg('<path d="M12 5v14M5 12h14"/>')}</div>
        <h3 style="margin:14px 0 6px">Estás en la vista global</h3>
        <p class="muted">${state.profiles.profiles.length ? 'Elige uno de tus perfiles en la barra superior o crea uno nuevo.' : 'Crea un perfil con tus marcas favoritas de procesador, placa, tarjeta de video, RAM, SSD y fuente para ver qué tendrías que cambiar.'}</p>
        <button class="btn primary" data-act="new">Crear perfil</button>
      </div>`;
    bindNew();
    return;
  }

  const m = state.report?.profileMatch;
  const STATUS = { ok: ['ok', 'Cumple'], change: ['warning', 'Cambiar'], optional: ['tip', 'Opcional'], info: ['tip', 'Info'] };
  page.innerHTML = `
    <div class="page-head vs-head">
      <div><h1>Tu equipo vs perfil «${esc(active.name)}»</h1><p>${esc(profileSummary(active))}</p></div>
      <div class="vs-actions"><button class="btn ghost" data-act="edit">Editar perfil</button><button class="btn ghost" data-act="new">Nuevo perfil</button></div>
    </div>
    ${
      !m
        ? '<div class="empty">Analizando tu equipo…</div>'
        : `<div class="vs-summary tone sev-${m.required.length ? 'warning' : 'ok'}">${svg(m.required.length ? SEV.warning.icon : SEV.ok.icon)}<div><b>${esc(m.summary)}</b>${m.optional.length ? `<small>${m.optional.length} cambio(s) opcional(es): no son necesarios para el rendimiento.</small>` : ''}</div></div>
          <div class="vs-cols"><span>Tu equipo actual</span><span></span><span>Lo que pide tu perfil</span></div>
          <div class="vs-list">${m.rows
            .map((r) => {
              const [sev, label] = STATUS[r.status];
              return `<div class="vs-row">
                <div class="vs-cur"><div class="ic">${svg(COMP[r.key].icon)}</div><div><small>${COMP[r.key].label}</small><b>${esc(r.current)}</b></div></div>
                <div class="vs-mid"><span class="chip tone sev-${sev}">${label}</span>${svg('<path d="M5 12h14m-6-6 6 6-6 6"/>')}</div>
                <div class="vs-want">
                  <small>${esc(r.wanted)}</small>
                  <p>${esc(r.message)}</p>
                  ${checksHtml(r.checks)}${r.options ? `<div class="opts">${r.options.map((o) => `<div class="opt ${o.tier === 'Superior' ? 'sup' : ''}"><span>${esc(o.tier)}</span><b>${esc(o.name)}</b><em class="num">${esc(o.diff || '')}</em></div>`).join('')}</div>` : ''}
                </div>
              </div>`;
            })
            .join('')}</div>
          <p class="muted" style="margin-top:14px">Equivalente: rinde igual o un poco más que tu componente actual. Superior: un salto claro de rendimiento. Los porcentajes comparan con tu equipo actual.</p>`
    }`;
  page.querySelector('[data-act="edit"]').addEventListener('click', () => {
    state.editing = { ...active };
    renderProfiles();
  });
  bindNew();
}

function bindNew() {
  $('#page-profiles [data-act="new"]')?.addEventListener('click', () => {
    state.editing = { budget: 'equilibrado' };
    renderProfiles();
  });
}

function profileEditor(b, e) {
  return `<form class="card editor" id="profileForm">
        <label class="fld"><span>Nombre del perfil</span><input name="name" maxlength="40" required value="${esc(e.name || '')}" placeholder="Ej. Mi PC gamer"></label>
        <div class="fld"><span>Procesador y plataforma</span>${segField('cpuBrand', b.cpu, e.cpuBrand)}</div>
        <div class="fld"><span>Marca de tarjeta de video (chip)</span>${segField('gpuBrand', b.gpu, e.gpuBrand)}</div>
        <div class="fgrid">
          <label class="fld"><span>Ensambladora de la tarjeta</span><select name="gpuMaker">${optionList(e.gpuBrand ? b.gpuMakers[e.gpuBrand] : [...new Set(Object.values(b.gpuMakers).flat())], e.gpuMaker)}</select></label>
          <label class="fld"><span>Placa madre</span><select name="boardBrand">${optionList(Object.keys(b.boards), e.boardBrand)}</select></label>
          <label class="fld"><span>Fuente de poder</span><select name="psuBrand">${optionList(Object.keys(b.psu), e.psuBrand)}</select></label>
          <label class="fld"><span>Memoria RAM</span><select name="ramBrand">${optionList(Object.keys(b.ram), e.ramBrand)}</select></label>
          <label class="fld"><span>SSD</span><select name="storageBrand">${optionList(Object.keys(b.storage), e.storageBrand)}</select></label>
        </div>
        <div class="fld"><span>Nivel de gasto</span>${segField('budget', Object.keys(BUDGETS), e.budget || 'equilibrado', BUDGETS).replace(/<button[^>]*data-v=""[^>]*>Cualquiera<\/button>/, '')}</div>
        <div class="frow">
          <div class="fld"><span>Uso principal</span>${segField('usage', ['gaming', 'creation', 'office'], e.usage, { gaming: 'Juegos', creation: 'Creación', office: 'Oficina' })}</div>
          <div class="fld"><span>Resolución</span>${segField('resolution', ['1080p', '1440p', '4k'], e.resolution, { '4k': '4K' })}</div>
        </div>
        <div class="form-actions">
          ${e.id ? '<button type="button" class="btn danger" data-act="delete">Eliminar</button>' : ''}
          <div class="grow"></div>
          <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>
          <button type="submit" class="btn primary">Guardar y usar</button>
        </div>
      </form>`;
}

function bindEditor(b) {
  const form = $('#profileForm');
  if (!form) return;
  form.querySelectorAll('.seg[data-field]').forEach((seg) =>
    seg.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      readForm();
      state.editing[seg.dataset.field] = btn.dataset.v || null;
      if (seg.dataset.field === 'gpuBrand' && state.editing.gpuMaker && !(b.gpuMakers[btn.dataset.v] || []).includes(state.editing.gpuMaker)) state.editing.gpuMaker = null;
      renderProfiles();
    })
  );
  function readForm() {
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) state.editing[k] = v || null;
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    readForm();
    state.profiles = await api.saveProfile(state.editing);
    state.editing = null;
    await activate(state.profiles.active);
    go('profiles');
  });
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    state.editing = null;
    renderProfiles();
  });
  form.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar el perfil «${state.editing.name}»?`)) return;
    const wasActive = state.profiles.active === state.editing.id;
    state.profiles = await api.removeProfile(state.editing.id);
    state.editing = null;
    if (wasActive) await activate(null);
    else {
      renderProfileSelect();
      renderProfiles();
    }
  });
}

// ---------------- Acerca de ----------------
async function renderAbout() {
  const [info, cat] = await Promise.all([api.appInfo(), api.catalogInfo()]);
  const fmtVersion = (v) => (v ? String(v).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5') : '—');
  const cal = cat.calibration;
  $('#page-about').innerHTML = `
    <div class="page-head"><h1>Acerca de HardScope</h1><p>Versión ${esc(info.version)}</p></div>
    <div class="card about">
      <p>HardScope analiza tu equipo, compara la placa madre con la tarjeta de video y el procesador, y propone mejoras.</p>
      <h3 style="margin-top:18px">Cómo se calculan los resultados</h3>
      <ul class="about-list">
        <li><b>Índices estimados:</b> cada tarjeta y procesador tiene un índice de referencia (RTX 4090 = 100). Para ${cat.curated} tarjetas se revisa a mano; para el resto se estima con resultados reales de Blender Open Data. No son FPS ni mediciones de tu equipo.</li>
        <li><b>Límite entre componentes:</b> se compara el índice del procesador (ajustado a la resolución elegida) con el de la tarjeta. Indica una tendencia; el resultado real depende del juego, la configuración y los límites de FPS. Para confirmarlo usa el Monitor en vivo.</li>
        <li><b>Índice del equipo (0-100):</b> parte de 100 y resta por cada aviso según su severidad. Es un resumen orientativo de los avisos, no una medida de rendimiento.</li>
        <li><b>Compatibilidad:</b> se deduce del chipset de la placa. Antes de comprar, confirma siempre la lista de CPUs compatibles y la BIOS en la web del fabricante de tu placa, y el tamaño y la alimentación de la tarjeta.</li>
      </ul>
      <h3 style="margin-top:18px">Catálogo de datos</h3>
      <p>Versión <b class="num">${esc(fmtVersion(cat.version))}</b> · ${cat.origin === 'downloaded' ? 'descargado de GitHub' : 'incluido en la app'}${cat.pending ? ` · <span class="tone sev-ok">versión ${esc(fmtVersion(cat.pending))} descargada, se aplica al reiniciar</span>` : ''}</p>
      <ul class="about-list">
        <li><b>${cat.extra} tarjetas de video</b> con especificaciones y <b>${cat.measured}</b> con rendimiento medido; <b>${cat.cpus}</b> procesadores medidos.</li>
        <li><b>Blender Open Data</b> (licencia CC0): resultados reales de render enviados por la comunidad${cat.snapshot ? `, hasta el ${esc(cat.snapshot)}` : ''}. <a data-url="https://opendata.blender.org/">opendata.blender.org</a></li>
        <li><b>open-gpu-db</b> (licencia Apache-2.0, basado en dbgpu): especificaciones de tarjetas (VRAM, PCIe, consumo, año). <a data-url="https://github.com/onepunk/open-gpu-db">github.com/onepunk/open-gpu-db</a></li>
        ${cal ? `<li><b>Estimación del índice de juegos</b> para tarjetas no revisadas: error típico ${cal.medianError} % (el 10 % peor, ${cal.p90Error} % o más), medido con ${cal.samples} tarjetas conocidas.</li>` : ''}
      </ul>
      <label class="toggle"><input type="checkbox" id="autoCatalog" ${state.settings.autoCatalog !== false ? 'checked' : ''}> Buscar un catálogo más nuevo al abrir la app</label>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn ghost" id="catBtn">Actualizar catálogo ahora</button>
        ${cat.pending ? '<button class="btn primary" id="relaunchBtn">Reiniciar para aplicar</button>' : ''}
        <span id="catMsg" style="color:var(--muted)"></span>
      </div>
      <h3 style="margin-top:18px">Privacidad</h3>
      <p>Todo el análisis se hace en tu equipo y no se envía ningún dato tuyo. Los perfiles se guardan solo en tu PC. Las conexiones a internet son de descarga: el catálogo de datos desde el repositorio de HardScope en GitHub (al abrir, si está activado) y la consulta de nuevas versiones, cuando pulsas el botón.</p>
      <label class="toggle"><input type="checkbox" id="hostToggle" ${state.settings.includeHost ? 'checked' : ''}> Incluir el nombre del equipo en los reportes exportados</label>
      <p class="muted" style="font-size:12.5px">«Buscar actualizaciones» solo avisa si hay una versión nueva de la app; la descarga e instalación las haces tú. El catálogo de datos sí se actualiza solo, y se verifica antes de usarlo.</p>
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" id="updBtn">Buscar actualizaciones</button>
        ${info.repo ? `<button class="btn ghost" id="repoBtn">Ver en GitHub</button>` : ''}
        <span id="updMsg" style="color:var(--muted)"></span>
      </div>
    </div>`;
  $('#page-about').querySelectorAll('a[data-url]').forEach((a) => a.addEventListener('click', () => api.openExternal(a.dataset.url)));
  $('#repoBtn')?.addEventListener('click', () => api.openExternal(`https://github.com/${info.repo}`));
  $('#hostToggle').addEventListener('change', (e) => {
    state.settings.includeHost = e.target.checked;
    saveSettings();
  });
  $('#autoCatalog').addEventListener('change', (e) => {
    state.settings.autoCatalog = e.target.checked;
    saveSettings();
  });
  $('#catBtn').addEventListener('click', () => updateCatalog(true));
  $('#relaunchBtn')?.addEventListener('click', () => api.relaunch());
  $('#updBtn').addEventListener('click', async () => {
    $('#updMsg').textContent = 'Consultando…';
    const u = await api.checkUpdate();
    if (u.error) $('#updMsg').textContent = `No se pudo consultar: ${u.error}`;
    else if (u.newer) {
      $('#updMsg').innerHTML = `Nueva versión ${esc(u.latest)} disponible. <a id="dl">Descargar</a>`;
      $('#dl').addEventListener('click', () => api.openExternal(u.url));
    } else $('#updMsg').textContent = 'Tienes la última versión.';
  });
}

// Busca un catálogo más nuevo en GitHub. Si se descarga, se aplica al reiniciar.
async function updateCatalog(manual) {
  const msg = $('#catMsg');
  if (manual && msg) msg.textContent = 'Consultando…';
  const res = await api.checkCatalog();
  const text = {
    updated: 'Catálogo nuevo descargado y verificado. Se aplicará al reiniciar la app.',
    'up-to-date': 'El catálogo ya está al día.',
    'needs-app': res.message,
    incompatible: res.message,
    error: `No se pudo actualizar el catálogo: ${res.message}`,
  }[res.status];
  if (res.status === 'updated') {
    flash('Catálogo de datos actualizado: se aplicará al reiniciar');
    renderAbout();
  } else if (manual && msg) msg.textContent = text;
}

renderAbout();
// Si los perfiles no cargan se sigue con la vista global: el análisis no debe quedar bloqueado.
initProfiles()
  .catch(() => flash('No se pudieron cargar los perfiles; se usa la vista global'))
  .finally(async () => {
    await scan();
    if (state.settings.autoCatalog !== false) updateCatalog(false).catch(() => {});
  });
