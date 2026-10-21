import { LineChart } from './chart.js';
import { buildReport } from './report.js';

const api = window.hardscope;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gb = (bytes, d = 0) => (bytes ? `${(bytes / 1024 ** 3).toFixed(d)} GB` : '—');

const SEV = {
  critical: { label: 'Crítico', icon: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM15 9l-6 6m0-6 6 6"/>' },
  warning: { label: 'Advertencia', icon: '<path d="M12 3 2 20h20L12 3zm0 6v5m0 3v.01"/>' },
  tip: { label: 'Consejo', icon: '<path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>' },
  ok: { label: 'Correcto', icon: '<path d="M20 6 9 17l-5-5"/>' },
};
const COMP = {
  cpu: { label: 'Procesador', icon: '<path d="M6 6h12v12H6zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M9.5 9.5h5v5h-5z"/>' },
  board: { label: 'Placa madre', icon: '<path d="M3 3h18v18H3zM7 7h4v4H7zm7 0h3m-3 3h3M7 15h10M7 18h6"/>' },
  gpu: { label: 'Tarjeta de video', icon: '<path d="M2 7h20v10H2zM6 17v3m4-3v3M7 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0m7-2h4m-4 3h4"/>' },
  ram: { label: 'Memoria RAM', icon: '<path d="M2 7h20v9H2zM6 16v3m4-3v3m4-3v3m4-3v3M6 10v3m4-3v3m4-3v3m4-3v3"/>' },
  storage: { label: 'Almacenamiento', icon: '<path d="M4 4h16v16H4zM8 16h.01M12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' },
  system: { label: 'Sistema', icon: '<path d="M3 4h18v12H3zM8 20h8m-4-4v4"/>' },
};
const svg = (path) => `<svg viewBox="0 0 24 24">${path}</svg>`;
const SEV_ORDER = ['critical', 'warning', 'tip', 'ok'];

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
    return { usage: 'gaming', resolution: '1440p', ...JSON.parse(localStorage.getItem('hs-settings') || '{}') };
  } catch {
    return { usage: 'gaming', resolution: '1440p' };
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
      const res = await api.reanalyze(apiSettings());
      if (res) apply(res);
    }
  });
}
bindSeg('#usageSeg', 'usage');
bindSeg('#resSeg', 'resolution');

$('#scanBtn').addEventListener('click', scan);
$('#exportBtn').addEventListener('click', async () => {
  const path = await api.exportReport(buildReport(state.profile, state.report));
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
  const steps = ['Leyendo procesador y placa madre', 'Midiendo el enlace PCIe de la tarjeta de video', 'Revisando módulos de memoria y perfiles XMP', 'Analizando discos y plan de energía', 'Buscando cuellos de botella'];
  let i = 0;
  const t = setInterval(() => ($('#loadingStep').textContent = steps[++i % steps.length]), 1100);
  try {
    const res = await api.scan(apiSettings());
    apply(res);
    flash(`Análisis completo · ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    $('#loadingStep').textContent = `Error al analizar: ${err.message}`;
    return;
  } finally {
    clearInterval(t);
    $('#scanBtn').disabled = false;
  }
  $('#loading').classList.remove('active');
  go(document.querySelector('#nav button.active')?.dataset.page || 'overview');
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
  renderLive();
  renderComponents();
}

const worstFor = (comp) => {
  const f = state.report.findings.filter((x) => x.component === comp);
  return SEV_ORDER.find((s) => f.some((x) => x.severity === s)) || 'ok';
};

// ---------------- Resumen ----------------
function renderOverview() {
  const r = state.report;
  const c = r.components;
  const healthSev = r.health >= 80 ? 'ok' : r.health >= 55 ? 'warning' : 'critical';
  const healthLabel = r.health >= 90 ? 'Excelente' : r.health >= 80 ? 'Muy bueno' : r.health >= 65 ? 'Mejorable' : r.health >= 45 ? 'Necesita atención' : 'Cuellos de botella graves';
  const circ = 2 * Math.PI * 80;
  const top = r.findings.find((f) => f.severity === 'critical' || f.severity === 'warning');
  const bvg = r.balance.boardVsGpu;
  const cvg = r.balance.cpuVsGpu;
  const pcie = r.balance.pcie;

  const verdictText = {
    gpu: ['La GPU supera a la placa', 'critical'],
    board: ['La placa supera a la GPU', 'tip'],
    balanced: ['Equilibradas', 'ok'],
    unknown: ['Sin datos suficientes', 'tip'],
  }[bvg.verdict];
  const cpuText = {
    cpu: [`CPU limita ≈${cvg.bottleneckPct}%`, cvg.bottleneckPct > 20 ? 'critical' : 'warning'],
    gpu: ['La GPU es el límite', 'tip'],
    balanced: ['Equilibrados', 'ok'],
    unknown: ['—', 'tip'],
  }[cvg.verdict];

  const cards = [
    { k: 'cpu', model: c.cpu.name, spec: `${state.profile.cpu.physicalCores} núcleos · ${state.profile.cpu.cores} hilos`, score: c.cpu.effScore },
    { k: 'board', model: `${c.board.manufacturer || ''} ${c.board.model || ''}`, spec: c.board.chipset ? `Chipset ${c.board.chipset.id} · ${c.board.platform?.socket} · PCIe ${c.board.chipset.gpuPcie}.0` : 'Chipset no identificado', score: c.board.platform?.effCeiling },
    { k: 'gpu', model: c.gpu?.match?.name || c.gpu?.name || 'Sin GPU', spec: c.gpu ? `${c.gpu.vramGb || '?'} GB VRAM${pcie.gpuGen ? ` · PCIe ${pcie.gpuGen}.0 x${pcie.lanes}` : ''}` : '', score: c.gpu?.score },
    { k: 'ram', model: `${c.ram.totalGb} GB ${c.ram.type || ''}`, spec: `${c.ram.modules} módulo(s) · ${c.ram.configured || '?'} MT/s${c.ram.ratedSpeed ? ` (nominal ${c.ram.ratedSpeed})` : ''} · ${c.ram.channel === 'dual' ? 'doble canal' : c.ram.channel === 'single' ? 'canal simple' : ''}` },
    { k: 'storage', model: c.storage.system?.name || 'Disco del sistema', spec: `${c.storage.system ? `${c.storage.system.type || ''} ${c.storage.system.bus || ''}` : ''}${c.storage.freePct != null ? ` · ${c.storage.freePct}% libre en C:` : ''}` },
  ];
  const maxScore = 130;

  $('#page-overview').innerHTML = `
    <div class="page-head"><h1>Resumen del equipo</h1><p>${esc(state.profile.system.manufacturer)} ${esc(state.profile.system.model)} · ${esc(state.profile.os.distro)} · análisis para ${labelUsage()} a ${esc(r.settings.resolution)}</p></div>
    <div class="hero">
      <div class="card health sev-${healthSev}">
        <div class="gauge">
          <svg viewBox="0 0 190 190"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="var(--c)"/></linearGradient></defs>
            <circle class="track" cx="95" cy="95" r="80"/><circle class="bar" cx="95" cy="95" r="80" stroke="url(#gg)" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" data-target="${circ * (1 - r.health / 100)}"/></svg>
          <div class="val"><b class="num">${r.health}</b><small>de 100</small></div>
        </div>
        <div class="label tone">${healthLabel}</div>
        <div class="chips">${SEV_ORDER.map((s) => `<span class="chip sev-${s}"><i style="background:var(--c)"></i>${r.counts[s]} ${SEV[s].label.toLowerCase()}${r.counts[s] === 1 || s === 'ok' ? '' : 's'}</span>`).join('')}</div>
      </div>
      <div class="headline">
        ${
          top
            ? `<div class="top tone sev-${top.severity}"><div class="kicker">${top.severity === 'critical' ? 'Cuello de botella principal' : 'Lo que más conviene mejorar'} · ${COMP[top.component].label}</div><h2>${esc(top.title)}</h2><p>${esc(top.detail)}</p>${top.action ? `<div class="action">${svg('<path d="M5 12h14m-6-6 6 6-6 6"/>')}<span><b>Qué hacer:</b> ${esc(top.action)}</span></div>` : ''}</div>`
            : `<div class="top tone sev-ok"><div class="kicker">Todo en orden</div><h2>No hay cuellos de botella importantes</h2><p>Tus componentes están bien equilibrados para ${labelUsage()}. Revisa la sección de diagnóstico para ver consejos menores.</p></div>`
        }
        <div class="quick">
          <div class="stat sev-${verdictText[1]}"><small>Placa vs tarjeta de video</small><b class="tone">${verdictText[0]}</b><em>${bvg.ceiling ? `Techo placa ${bvg.ceiling} · GPU ${bvg.gpuScore ?? '?'}` : ''}</em></div>
          <div class="stat sev-${cpuText[1]}"><small>Procesador vs GPU</small><b class="tone">${cpuText[0]}</b><em>CPU ${cvg.cpuScore} · GPU ${cvg.gpuScore ?? '?'}</em></div>
          <div class="stat sev-${pcie.effBW && pcie.effBW < pcie.fullBW ? 'warning' : 'ok'}"><small>Enlace PCIe de la GPU</small><b class="tone num">${pcie.linkGen ? `${pcie.linkGen}.0 x${pcie.curWidth || pcie.lanes}` : '—'}</b><em>${pcie.effBW ? `${pcie.effBW} de ${pcie.fullBW} GB/s` : ''}</em></div>
        </div>
      </div>
    </div>
    ${
      r.upgrades.steps[0]
        ? `<div class="next-banner" id="nextBanner">${svg('<path d="M12 19V5m-6 6 6-6 6 6"/>')}<div><small>Tu próxima mejora</small><b>${esc(r.upgrades.steps[0].pick)}</b></div><span class="num">+${r.upgrades.steps[0].gainPct}%</span>${svg('<path d="m9 6 6 6-6 6"/>')}</div>`
        : ''
    }
    <div class="comp-grid">
      ${cards
        .map((x) => {
          const s = worstFor(x.k);
          return `<div class="comp" data-go="${x.k === 'board' || x.k === 'gpu' ? 'balance' : 'findings'}" data-filter="${x.k}">
            <div class="ic">${svg(COMP[x.k].icon)}</div>
            <span class="status tone sev-${s}">${SEV[s].label}</span>
            <div class="kind">${COMP[x.k].label}</div>
            <div class="model">${esc(x.model)}</div>
            <div class="spec">${esc(x.spec)}</div>
            ${x.score != null ? `<div class="meter" title="Puntaje ${x.score}"><i style="width:${Math.min(100, (x.score / maxScore) * 100)}%"></i></div>` : ''}
          </div>`;
        })
        .join('')}
    </div>`;

  requestAnimationFrame(() => {
    const bar = $('#page-overview .gauge .bar');
    if (bar) bar.style.strokeDashoffset = bar.dataset.target;
  });
  $('#nextBanner')?.addEventListener('click', () => go('upgrade'));
  $('#page-overview').querySelectorAll('.comp').forEach((el) =>
    el.addEventListener('click', () => {
      if (el.dataset.go === 'findings') {
        state.filter = el.dataset.filter;
        renderFindings();
      }
      go(el.dataset.go);
    })
  );
}

const labelUsage = () => ({ gaming: 'juegos', creation: 'creación de contenido', office: 'oficina' })[state.report.settings.usage];

// ---------------- Diagnóstico ----------------
function findingHtml(f) {
  return `<article class="finding sev-${f.severity}">
    <div class="sic">${svg(SEV[f.severity].icon)}</div>
    <div>
      <div class="meta"><span>${SEV[f.severity].label}</span><span>${COMP[f.component].label}</span></div>
      <h4>${esc(f.title)}</h4>
      <p>${esc(f.detail)}</p>
      ${f.action ? `<div class="todo">${svg('<path d="M5 12h14m-6-6 6 6-6 6"/>')}<div><b>Qué hacer:</b> ${esc(f.action)}</div></div>` : ''}
    </div>
  </article>`;
}

function renderFindings() {
  const r = state.report;
  const comps = ['all', ...Object.keys(COMP).filter((k) => r.findings.some((f) => f.component === k))];
  if (!comps.includes(state.filter)) state.filter = 'all';
  const list = r.findings.filter((f) => state.filter === 'all' || f.component === state.filter);
  $('#page-findings').innerHTML = `
    <div class="page-head"><h1>Diagnóstico y consejos</h1><p><span class="tone sev-critical">● Rojo</span>: cuello de botella que debes corregir · <span class="tone sev-warning">● Amarillo</span>: conviene mejorar · <span class="tone sev-tip">● Azul</span>: consejo · <span class="tone sev-ok">● Verde</span>: correcto</p></div>
    <div class="filters">${comps.map((k) => `<button data-f="${k}" class="${state.filter === k ? 'on' : ''}">${k === 'all' ? 'Todos' : COMP[k].label} <span class="num">${k === 'all' ? r.findings.length : r.findings.filter((f) => f.component === k).length}</span></button>`).join('')}</div>
    ${list.map(findingHtml).join('') || '<div class="empty">Nada que mostrar aquí.</div>'}`;
  $('#page-findings .filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.filter = b.dataset.f;
    renderFindings();
  });
}

// ---------------- Placa vs GPU ----------------
function renderBalance() {
  const r = state.report;
  const { board, gpu, cpu } = r.components;
  const { boardVsGpu: bvg, cpuVsGpu: cvg, pcie } = r.balance;
  const f = r.findings.find((x) => ['board-limits-gpu', 'board-superior', 'board-gpu-balanced'].includes(x.id));
  const V = {
    gpu: { sev: f?.severity || 'warning', title: 'La placa no aprovecha todo el rendimiento de tu tarjeta de video', icon: '<path d="M12 3 2 20h20L12 3zm0 6v5m0 3v.01"/>' },
    board: { sev: f?.severity || 'tip', title: 'Tu placa es superior a tu tarjeta de video: puede soportar tarjetas más potentes', icon: '<path d="M12 19V5m-6 6 6-6 6 6"/>' },
    balanced: { sev: 'ok', title: 'Placa y tarjeta de video están bien emparejadas', icon: SEV.ok.icon },
    unknown: { sev: 'tip', title: 'No hay datos suficientes para comparar', icon: SEV.tip.icon },
  }[bvg.verdict];

  const max = Math.max(bvg.ceiling || 0, bvg.gpuScore || 0, cvg.cpuScore || 0, 40) * 1.15;
  const pos = (v) => `${Math.min(100, (v / max) * 100)}%`;
  const lanesUsed = pcie.curWidth || pcie.lanes || 0;
  const recs = r.findings.filter((x) => ['board', 'gpu', 'cpu'].includes(x.component) && x.severity !== 'ok');

  $('#page-balance').innerHTML = `
    <div class="page-head"><h1>Placa madre vs tarjeta de video</h1><p>Compara lo que la placa (y la plataforma que define: socket, procesadores compatibles y PCIe) puede alimentar contra lo que rinde tu GPU.</p></div>
    <div class="verdict tone sev-${V.sev}" style="border-color:color-mix(in srgb,var(--c) 40%,transparent);background:color-mix(in srgb,var(--c) 7%,transparent)">
      <div class="big">${svg(V.icon)}</div>
      <div><h2>${esc(V.title)}</h2><p>${esc(f?.detail || '')}</p>${f?.action ? `<p style="margin-top:8px;color:var(--text)"><b>Qué hacer:</b> ${esc(f.action)}</p>` : ''}</div>
    </div>
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
          <dt>Techo de GPU (${esc(r.settings.resolution)})</dt><dd class="num">${bvg.ceiling ?? '—'}</dd>
        </dl>
      </div>
      <div class="mid"><small>relación</small><b class="num">${bvg.ratio != null ? `${Math.round(bvg.ratio * 100)}%` : '—'}</b><small>GPU / techo</small></div>
      <div class="card side">
        <h3>${svg(COMP.gpu.icon)} Tarjeta de video</h3>
        <h2>${esc(gpu?.match?.name || gpu?.name || 'Sin GPU')}</h2>
        <div class="sub">${gpu?.integrated ? 'Gráficos integrados' : gpu?.match ? `Generación ${gpu.match.year}` : 'Modelo no reconocido'}</div>
        <dl class="kv">
          <dt>Puntaje de rendimiento</dt><dd class="num">${gpu?.score ?? '—'}</dd>
          <dt>Interfaz</dt><dd>${pcie.gpuGen ? `PCIe ${pcie.gpuGen}.0 x${pcie.lanes}` : '—'}</dd>
          <dt>Enlace actual</dt><dd>${pcie.curWidth ? `x${pcie.curWidth}${pcie.curGen ? ` · Gen ${pcie.curGen}` : ''}` : '—'}</dd>
          <dt>VRAM</dt><dd>${gpu?.vramGb ? `${gpu.vramGb} GB` : '—'}</dd>
          <dt>Driver</dt><dd>${esc(gpu?.driverVersion || '—')}</dd>
        </dl>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Escala de rendimiento (RTX 4090 = 100)</h3>
      <div class="scale">
        <div class="rail"></div>
        ${bvg.gpuScore != null ? `<div class="fill" style="left:0;width:${pos(bvg.gpuScore)}"></div>` : ''}
        ${bvg.ceiling ? `<div class="mark" style="left:${pos(bvg.ceiling)};color:var(--tip)">Techo de la placa ${bvg.ceiling}<i style="background:var(--tip)"></i></div>` : ''}
        ${bvg.gpuScore != null ? `<div class="mark" style="left:${pos(bvg.gpuScore)};color:var(--cyan)">GPU ${bvg.gpuScore}<i style="background:var(--cyan)"></i></div>` : ''}
        <div class="mark below" style="left:${pos(cvg.cpuScore)};color:var(--violet)">CPU ${cvg.cpuScore}<i style="background:var(--violet)"></i></div>
      </div>
      <p style="color:var(--muted);margin:26px 0 0;font-size:12.5px">Si la GPU queda a la derecha del techo de la placa o del CPU, la tarjeta no rinde al 100%. Si queda muy a la izquierda, la placa admite una tarjeta bastante mejor.</p>
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
          <div class="mark" style="left:${Math.min(98, cvg.bottleneckPct * 1.6 + 2)}%;color:var(--text)">${cvg.verdict === 'cpu' ? `Cuello de botella CPU ≈${cvg.bottleneckPct}%` : cvg.verdict === 'gpu' ? 'La GPU es el límite' : 'Sin cuello de botella'}<i style="background:#fff"></i></div>
        </div>
        <dl class="kv" style="margin-top:28px">
          <dt>Puntaje CPU (${esc(r.settings.resolution)})</dt><dd class="num">${cvg.cpuScore}</dd>
          <dt>Puntaje GPU</dt><dd class="num">${cvg.gpuScore ?? '—'}</dd>
          <dt>Consejo</dt><dd>${cvg.verdict === 'cpu' ? 'Subir de procesador o jugar a mayor resolución' : cvg.verdict === 'gpu' ? 'Mejorar la tarjeta de video' : 'Mantener'}</dd>
        </dl>
      </div>
    </div>
    ${recs.length ? `<div class="page-head" style="margin-top:24px"><h1 style="font-size:20px">Recomendaciones para placa, GPU y CPU</h1></div>${recs.map(findingHtml).join('')}` : ''}`;
}

// ---------------- Próxima mejora ----------------
const STEP_ICON = { gpu: COMP.gpu.icon, cpu: COMP.cpu.icon, platform: COMP.board.icon };
const LIMITER = { cpu: 'el procesador', gpu: 'la tarjeta de video', board: 'la placa' };

const afterBadge = (snap) =>
  snap.balanced
    ? `<span class="chip sev-ok tone">${svg(SEV.ok.icon)}Sin cuello de botella</span>`
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
          <div class="up-gain">${next.gainPct < 5 ? '<b class="num">Base</b><span>prepara el siguiente paso</span>' : `<b class="num">+${next.gainPct}%</b><span>de rendimiento<br>en tu equipo</span>`}</div>
        </div>
        <p>${esc(next.reason)}</p>
        ${next.alternatives.length ? `<div class="alts"><small>Alternativas sin cuello de botella:</small>${next.alternatives.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>` : ''}
        ${stepNotes(next)}
      </div>
      <div class="card cmp-card"><h3>Antes y después</h3>${compareTable(next.compare)}</div>`
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
                <p class="muted" style="margin:6px 0 10px">${esc(s.reason)}</p>
                ${stepNotes(s)}
                <div class="road-foot">${afterBadge(s.after)}<span class="muted num">CPU ${s.after.cpu} · GPU ${s.after.gpu}${s.after.ceiling ? ` · Placa ${s.after.ceiling}` : ''}</span></div>
              </div>
            </div>`
          )
          .join('')}</div>`
      : '';

  $('#page-upgrade').innerHTML = `
    <div class="page-head"><h1>Tu próxima mejora</h1><p>Qué conviene actualizar ahora para ganar rendimiento sin crear un cuello de botella nuevo (${labelUsage()} a ${esc(state.report.settings.resolution)}).</p></div>
    ${hero}${road}
    ${u.steps.length ? `<p class="muted" style="margin-top:18px">${esc(u.final)} Los porcentajes son estimaciones de rendimiento en juegos.</p>` : ''}`;
}

// ---------------- Monitor en vivo ----------------
const LIVE_STATES = {
  idle: ['tip', 'Equipo en reposo', 'Abre un juego o programa pesado y deja el monitor corriendo para detectar el cuello de botella real.'],
  'gpu-bound': ['ok', 'La GPU trabaja al máximo', 'Es lo ideal en juegos: el procesador alimenta bien a la tarjeta. Para más FPS, la mejora sería la GPU.'],
  'cpu-bound': ['critical', 'Cuello de botella de CPU ahora mismo', 'La GPU está esperando al procesador. Sube la resolución/calidad gráfica, limita los FPS o mejora el CPU.'],
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
        .map(([k, l, u]) => `<div class="lg" data-k="${k}"><small>${l}</small><b class="num">—<em>${u}</em></b><div class="meter"><i style="width:0"></i></div></div>`)
        .join('')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="legend"><span style="--lc:#22d3ee">CPU</span><span style="--lc:#8b5cf6">GPU</span><span style="--lc:#2ee6a0">RAM</span><span style="--lc:#ffb547">VRAM</span><span style="--lc:#ff4d6d">Núcleo máx.</span></div>
      <div class="chart-wrap"><canvas id="liveChart"></canvas></div>
    </div>
    <div class="two">
      <div class="card"><h3>Carga por hilo del procesador</h3><div class="cores" id="cores"></div></div>
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
function renderComponents() {
  const p = state.profile;
  const r = state.report;
  const table = (rows) => `<table>${rows.filter((x) => x[1] != null && x[1] !== '').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const block = (k, inner) => `<div class="card spec-card"><div class="head">${svg(COMP[k].icon)}<h3 style="margin:0">${COMP[k].label}</h3></div>${inner}</div>`;
  const ram = r.components.ram;
  $('#page-components').innerHTML = `
    <div class="page-head"><h1>Componentes detectados</h1><p>Inventario completo de tu equipo.</p></div>
    ${block('cpu', table([
      ['Modelo', r.components.cpu.name],
      ['Núcleos / hilos', `${p.cpu.physicalCores} / ${p.cpu.cores}`],
      ['Núcleos P / E', p.cpu.performanceCores && p.cpu.efficiencyCores ? `${p.cpu.performanceCores} / ${p.cpu.efficiencyCores}` : null],
      ['Frecuencia base', p.cpu.speed ? `${p.cpu.speed} GHz` : null],
      ['Caché L3', p.cpu.cache?.l3 ? `${Math.round(p.cpu.cache.l3 / 1024 / 1024)} MB` : null],
      ['Puntaje estimado', `${r.components.cpu.score}${r.components.cpu.estimated ? ' (aproximado)' : ''}`],
    ]))}
    ${block('board', table([
      ['Fabricante', p.board.manufacturer],
      ['Modelo', p.board.model],
      ['Chipset', r.components.board.chipset?.id || 'No identificado'],
      ['Socket', r.components.board.platform?.socket],
      ['BIOS', `${p.bios.vendor || ''} ${p.bios.version || ''} (${p.bios.releaseDate || '—'})`],
      ['Ranuras de RAM', ram.slots],
      ['RAM máxima', ram.maxGb ? `${ram.maxGb} GB` : null],
    ]))}
    ${r.components.gpus.map((g) => block('gpu', table([
      ['Modelo', g.name],
      ['Fabricante', g.vendor],
      ['VRAM', g.vramGb ? `${g.vramGb} GB` : 'Compartida'],
      ['Tipo', g.integrated ? 'Integrada' : 'Dedicada'],
      ['Enlace PCIe actual', g.pcie?.curWidth ? `Gen ${g.pcie.curGen} x${g.pcie.curWidth}` : null],
      ['Enlace PCIe máximo', g.pcie?.maxWidth ? `Gen ${g.pcie.maxGen} x${g.pcie.maxWidth}` : null],
      ['Driver', g.driverVersion],
      ['Puntaje', g.score],
    ]))).join('')}
    ${block('ram', `${table([
      ['Total', `${ram.totalGb} GB ${ram.type || ''}`],
      ['Velocidad actual', ram.configured ? `${ram.configured} MT/s` : null],
      ['Velocidad nominal (XMP/EXPO)', ram.ratedSpeed ? `${ram.ratedSpeed} MT/s` : 'No determinada'],
      ['Canal', ram.channel === 'dual' ? 'Doble canal' : ram.channel === 'single' ? 'Canal simple' : '—'],
    ])}<table style="margin-top:10px"><tr><th>Ranura</th><th>Capacidad</th><th>Velocidad</th><th>Fabricante</th><th>Número de parte</th></tr>${p.ram.modules.map((m) => `<tr><td>${esc(m.locator)}</td><td>${gb(m.size)}</td><td>${esc(m.configuredSpeed)} MT/s</td><td>${esc(m.manufacturer)}</td><td class="num">${esc(m.partNum)}</td></tr>`).join('')}</table>`)}
    ${block('storage', `<table><tr><th>Disco</th><th>Tipo</th><th>Interfaz</th><th>Capacidad</th><th></th></tr>${p.disks.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.type || '—')}</td><td>${esc(d.bus || '—')}</td><td>${gb(d.size)}</td><td>${d.isSystem ? 'Sistema' : ''}</td></tr>`).join('')}</table>`)}
    ${block('system', table([
      ['Sistema operativo', `${p.os.distro} ${p.os.release} (build ${p.os.build})`],
      ['Arquitectura', p.os.arch],
      ['Plan de energía', p.power?.name],
      ['Pantallas', p.displays.map((d) => `${d.resolutionX}×${d.resolutionY} @ ${d.refreshRate || '?'} Hz`).join(' · ')],
    ]))}`;
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
    const res = await api.reanalyze(apiSettings());
    if (res) apply(res);
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
  const list = state.profiles.profiles;
  const e = state.editing;
  const card = (p) => `<div class="pcard ${state.profiles.active === (p?.id ?? null) ? 'active' : ''}" data-id="${esc(p?.id ?? '')}">
      <div class="pc-top"><div class="avatar">${p ? esc(p.name.slice(0, 1).toUpperCase()) : svg('<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>')}</div>
        <div><b>${p ? esc(p.name) : 'Vista global'}</b><small>${p ? esc(profileSummary(p)) : 'Recomendaciones genéricas, sin preferencias de marca'}</small></div></div>
      <div class="pc-actions">
        ${state.profiles.active === (p?.id ?? null) ? '<span class="chip sev-ok tone">En uso</span>' : `<button class="btn ghost sm" data-act="use">Usar</button>`}
        ${p ? `<button class="btn ghost sm" data-act="edit">Editar</button>` : ''}
      </div>
    </div>`;

  const editor = e
    ? `<form class="card editor" id="profileForm">
        <h3>${e.id ? 'Editar perfil' : 'Nuevo perfil'}</h3>
        <label class="fld"><span>Nombre del perfil</span><input name="name" maxlength="40" required value="${esc(e.name || '')}" placeholder="Ej. Mi PC gamer"></label>
        <div class="fld"><span>Marca de procesador</span>${segField('cpuBrand', b.cpu, e.cpuBrand)}</div>
        <div class="fld"><span>Marca de tarjeta de video (chip)</span>${segField('gpuBrand', b.gpu, e.gpuBrand)}</div>
        <div class="fgrid">
          <label class="fld"><span>Ensambladora de la tarjeta</span><select name="gpuMaker">${optionList(e.gpuBrand ? b.gpuMakers[e.gpuBrand] : [...new Set(Object.values(b.gpuMakers).flat())], e.gpuMaker)}</select></label>
          <label class="fld"><span>Placa madre</span><select name="boardBrand">${optionList(Object.keys(b.boards), e.boardBrand)}</select></label>
          <label class="fld"><span>Fuente de poder</span><select name="psuBrand">${optionList(Object.keys(b.psu), e.psuBrand)}</select></label>
          <label class="fld"><span>Memoria RAM</span><select name="ramBrand">${optionList(Object.keys(b.ram), e.ramBrand)}</select></label>
          <label class="fld"><span>SSD</span><select name="storageBrand">${optionList(Object.keys(b.storage), e.storageBrand)}</select></label>
        </div>
        <div class="fld"><span>Nivel de gasto</span>${segField('budget', Object.keys(BUDGETS), e.budget || 'equilibrado', BUDGETS).replace(/<button[^>]*data-v=""[^>]*>Cualquiera<\/button>/, '')}</div>
        <div class="fgrid">
          <div class="fld"><span>Uso principal</span>${segField('usage', ['gaming', 'creation', 'office'], e.usage, { gaming: 'Juegos', creation: 'Creación', office: 'Oficina' })}</div>
          <div class="fld"><span>Resolución</span>${segField('resolution', ['1080p', '1440p', '4k'], e.resolution, { '4k': '4K' })}</div>
        </div>
        <div class="form-actions">
          ${e.id ? '<button type="button" class="btn danger" data-act="delete">Eliminar</button>' : ''}
          <div class="grow"></div>
          <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>
          <button type="submit" class="btn primary">Guardar y usar</button>
        </div>
      </form>`
    : `<div class="card editor empty-editor">
        <div class="avatar big">${svg('<path d="M12 5v14M5 12h14"/>')}</div>
        <h3 style="margin:14px 0 6px">Crea tu perfil</h3>
        <p class="muted">Elige tus marcas favoritas de procesador, tarjeta de video, placa, fuente, RAM y SSD, y cuánto quieres gastar. Las recomendaciones de mejora se ajustarán a ti en lugar de ser genéricas.</p>
        <button class="btn primary" data-act="new">Crear perfil</button>
      </div>`;

  $('#page-profiles').innerHTML = `
    <div class="page-head"><h1>Mis perfiles</h1><p>Por defecto HardScope muestra una vista global. Con un perfil, la próxima mejora y los consejos se anclan a tus preferencias.</p></div>
    <div class="profiles-layout">
      <div class="plist">${card(null)}${list.map(card).join('')}</div>
      ${editor}
    </div>`;

  const page = $('#page-profiles');
  page.querySelectorAll('.pcard').forEach((el) =>
    el.addEventListener('click', async (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      const id = el.dataset.id || null;
      if (act === 'edit') {
        state.editing = { ...list.find((p) => p.id === id) };
        renderProfiles();
      } else if (act === 'use') await activate(id);
    })
  );
  page.querySelector('[data-act="new"]')?.addEventListener('click', () => {
    state.editing = { budget: 'equilibrado' };
    renderProfiles();
  });

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
    go(state.report ? 'upgrade' : 'profiles');
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
  const info = await api.appInfo();
  $('#page-about').innerHTML = `
    <div class="page-head"><h1>Acerca de HardScope</h1><p>Versión ${esc(info.version)}</p></div>
    <div class="card about">
      <p>HardScope analiza tu equipo, compara la placa madre con la tarjeta de video y el procesador, y detecta cuellos de botella con consejos concretos de mejora.</p>
      <p>Los puntajes son estimaciones basadas en una base de datos local de GPUs, chipsets y procesadores (<span class="num">src/data</span>). Se amplía con cada versión.</p>
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" id="updBtn">Buscar actualizaciones</button>
        ${info.repo ? `<button class="btn ghost" id="repoBtn">Ver en GitHub</button>` : ''}
        <span id="updMsg" style="color:var(--muted)"></span>
      </div>
    </div>`;
  $('#repoBtn')?.addEventListener('click', () => api.openExternal(`https://github.com/${info.repo}`));
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

renderAbout();
initProfiles().then(scan);
