'use strict';

const state = {
  projects: [],
  summary: null,
  filter: 'all',
  selectedId: null
};

const els = {
  projectGrid: document.getElementById('projectGrid'),
  brainList: document.getElementById('brainList'),
  syncButton: document.getElementById('syncButton'),
  lastSync: document.getElementById('lastSync'),
  connection: document.getElementById('connectionStatus'),
  drawer: document.getElementById('projectDrawer'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  drawerTitle: document.getElementById('drawerTitle'),
  drawerBody: document.getElementById('drawerBody'),
  closeDrawer: document.getElementById('closeDrawer'),
  toast: document.getElementById('toast'),
  mobileMenu: document.getElementById('mobileMenu'),
  sidebar: document.querySelector('.sidebar'),
  pageTitle: document.getElementById('pageTitle')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatRelative(value) {
  if (!value) return 'No activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function lines(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
}

async function api(url, options = {}, retried = false) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const key = sessionStorage.getItem('aiFactoryKey');
  if (key) headers['x-ai-factory-key'] = key;

  const response = await fetch(url, { ...options, headers });
  let payload = {};
  try { payload = await response.json(); } catch (_) {}

  if (response.status === 401 && !retried) {
    const entered = window.prompt('This AI Factory has write protection. Enter its write key:');
    if (entered) {
      sessionStorage.setItem('aiFactoryKey', entered);
      return api(url, options, true);
    }
  }

  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 2300);
}

function attentionNeeded(project) {
  return ['stale', 'unavailable'].includes(project.github?.activity) || (project.brain?.blockers || []).length > 0;
}

function visibleProjects() {
  if (state.filter === 'active') return state.projects.filter(project => ['active', 'warm'].includes(project.github?.activity));
  if (state.filter === 'attention') return state.projects.filter(attentionNeeded);
  return state.projects;
}

function projectCard(project) {
  const gh = project.github || {};
  const activity = gh.activity || 'unknown';
  const branch = gh.defaultBranch || '—';
  const commit = gh.latestCommit;
  const blockerCount = project.brain?.blockers?.length || 0;
  const fact3 = blockerCount ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}` : `${gh.openItems ?? '—'} open items`;
  return `
    <article class="project-card" data-project="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(project.name)} project brain">
      <div class="project-top">
        <div class="project-name">
          <span class="project-stage">${escapeHtml(project.stage)}</span>
          <h4>${escapeHtml(project.name)}</h4>
        </div>
        <span class="status-pill status-${escapeHtml(activity)}"><i class="status-dot"></i>${escapeHtml(activity)}</span>
      </div>
      <p class="project-purpose">${escapeHtml(project.purpose)}</p>
      ${gh.error ? `<div class="error-note">${escapeHtml(gh.error)}</div>` : `
        <div class="project-facts">
          <div class="fact"><span>Branch</span><b>${escapeHtml(branch)}</b></div>
          <div class="fact"><span>Last push</span><b>${escapeHtml(formatRelative(gh.pushedAt))}</b></div>
          <div class="fact"><span>Attention</span><b>${escapeHtml(fact3)}</b></div>
        </div>
        <div class="project-footer">
          <div class="commit-line">${commit ? `<code>${escapeHtml(commit.shortSha)}</code> · ${escapeHtml(commit.message)}` : 'No commit data'}</div>
          <span class="open-brain">OPEN BRAIN →</span>
        </div>
      `}
    </article>`;
}

function renderProjects() {
  const projects = visibleProjects();
  els.projectGrid.innerHTML = projects.length
    ? projects.map(projectCard).join('')
    : '<div class="empty-state">No projects match this view.</div>';
}

function renderBrainList() {
  els.brainList.innerHTML = state.projects.map(project => {
    const blockers = project.brain?.blockers?.length || 0;
    const next = project.brain?.nextActions?.[0] || 'No next action recorded';
    return `
      <article class="brain-row" data-project="${escapeHtml(project.id)}" tabindex="0" role="button">
        <div><h4>${escapeHtml(project.name)}</h4><small>${escapeHtml(project.stage)}</small></div>
        <p class="brain-state">${escapeHtml(project.brain?.currentState || 'No state recorded.')}</p>
        <p class="brain-next">Next: ${escapeHtml(next)}</p>
        <div class="brain-count"><b>${blockers}</b> blockers</div>
      </article>`;
  }).join('');
}

function renderSummary() {
  const s = state.summary || {};
  document.getElementById('statTotal').textContent = s.total ?? '—';
  document.getElementById('statActive').textContent = s.active ?? '—';
  document.getElementById('statAttention').textContent = s.attention ?? '—';
  document.getElementById('statBlockers').textContent = s.blockers ?? '—';
  els.lastSync.textContent = s.lastSynced ? formatDate(s.lastSynced) : '—';

  const auth = Boolean(s.githubAuthenticated);
  els.connection.className = `connection ${auth ? 'connected' : 'limited'}`;
  els.connection.innerHTML = `
    <span class="pulse"></span>
    <div>
      <strong>${auth ? 'GitHub connected' : 'GitHub public mode'}</strong>
      <small>${auth ? 'Private + public repos' : 'Add GITHUB_TOKEN for private repos/builds'}</small>
    </div>`;
}

async function loadProjects(force = false) {
  els.syncButton.classList.add('loading');
  els.syncButton.disabled = true;
  try {
    const data = await api(`/api/projects${force ? '?refresh=1' : ''}`);
    state.projects = data.projects || [];
    state.summary = data.summary || {};
    renderSummary();
    renderProjects();
    renderBrainList();
    if (state.selectedId) {
      const selected = state.projects.find(project => project.id === state.selectedId);
      if (selected) renderDrawer(selected);
    }
    if (force) toast('GitHub state refreshed');
  } catch (error) {
    els.projectGrid.innerHTML = `<div class="empty-state">Mission Control could not load: ${escapeHtml(error.message)}</div>`;
    toast(error.message);
  } finally {
    els.syncButton.classList.remove('loading');
    els.syncButton.disabled = false;
  }
}

function buildStatusText(build) {
  if (!build) return 'Unknown';
  if (build.conclusion) return build.conclusion;
  if (build.status === 'not-checked') return 'Token needed';
  return build.status || 'Unknown';
}

function decisionMarkup(decision) {
  return `
    <article class="decision">
      <div class="decision-top"><h5>${escapeHtml(decision.title || 'Decision')}</h5><time>${escapeHtml(decision.date || '')}</time></div>
      <p>${escapeHtml(decision.decision || '')}</p>
      ${decision.reason ? `<p class="reason">Why: ${escapeHtml(decision.reason)}</p>` : ''}
    </article>`;
}

function renderDrawer(project) {
  const gh = project.github || {};
  const brain = project.brain || {};
  els.drawerTitle.textContent = project.name;
  els.drawerBody.innerHTML = `
    <section class="drawer-section">
      <p class="drawer-section-title">Repository state</p>
      ${gh.error ? `<div class="error-note">${escapeHtml(gh.error)}</div>` : `
        <div class="repo-strip">
          <div class="repo-chip"><span>Activity</span><b>${escapeHtml(gh.activity || 'unknown')}</b></div>
          <div class="repo-chip"><span>Branch</span><b>${escapeHtml(gh.defaultBranch || '—')}</b></div>
          <div class="repo-chip"><span>Build</span><b>${escapeHtml(buildStatusText(gh.build))}</b></div>
          <div class="repo-chip"><span>Last push</span><b>${escapeHtml(formatRelative(gh.pushedAt))}</b></div>
          <div class="repo-chip"><span>Open items</span><b>${escapeHtml(gh.openItems ?? '—')}</b></div>
          <div class="repo-chip"><span>Visibility</span><b>${escapeHtml(gh.visibility || '—')}</b></div>
        </div>
      `}
    </section>

    <section class="drawer-section">
      <p class="drawer-section-title">Working memory</p>
      <label class="field"><span>Current state</span><textarea id="brainCurrent">${escapeHtml(brain.currentState || '')}</textarea></label>
      <label class="field"><span>Next actions</span><textarea class="short-area" id="brainNext">${escapeHtml((brain.nextActions || []).join('\n'))}</textarea></label>
      <p class="helper">One action per line. Keep this to the smallest set of things that actually move the project.</p>
      <label class="field"><span>Blockers</span><textarea class="short-area" id="brainBlockers">${escapeHtml((brain.blockers || []).join('\n'))}</textarea></label>
      <button class="primary-button" id="saveBrain">SAVE PROJECT BRAIN</button>
    </section>

    <section class="drawer-section">
      <div class="decision-top">
        <p class="drawer-section-title">Decision log</p>
        <button class="secondary-button" id="toggleDecision">+ ADD DECISION</button>
      </div>
      <div class="decision-form hidden" id="decisionForm">
        <label class="field"><span>Decision title</span><input id="decisionTitle" placeholder="e.g. Use MapLibre for the MVP"></label>
        <label class="field"><span>What did we decide?</span><textarea id="decisionText"></textarea></label>
        <label class="field"><span>Why?</span><textarea class="short-area" id="decisionReason"></textarea></label>
        <button class="primary-button" id="saveDecision">RECORD DECISION</button>
      </div>
      <div id="decisionList">
        ${(brain.decisions || []).length ? (brain.decisions || []).map(decisionMarkup).join('') : '<p class="helper">No decisions recorded yet.</p>'}
      </div>
    </section>`;

  document.getElementById('saveBrain').addEventListener('click', saveBrain);
  document.getElementById('toggleDecision').addEventListener('click', () => document.getElementById('decisionForm').classList.toggle('hidden'));
  document.getElementById('saveDecision').addEventListener('click', saveDecision);
}

function openDrawer(projectId) {
  const project = state.projects.find(item => item.id === projectId);
  if (!project) return;
  state.selectedId = projectId;
  renderDrawer(project);
  els.drawer.classList.add('open');
  els.drawerBackdrop.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  els.drawer.classList.remove('open');
  els.drawerBackdrop.classList.remove('open');
  els.drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  state.selectedId = null;
}

async function saveBrain() {
  if (!state.selectedId) return;
  const button = document.getElementById('saveBrain');
  button.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(state.selectedId)}/brain`, {
      method: 'PUT',
      body: JSON.stringify({
        currentState: document.getElementById('brainCurrent').value,
        nextActions: lines(document.getElementById('brainNext').value),
        blockers: lines(document.getElementById('brainBlockers').value)
      })
    });
    toast('Project Brain saved');
    await loadProjects(false);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveDecision() {
  if (!state.selectedId) return;
  const button = document.getElementById('saveDecision');
  const decision = document.getElementById('decisionText').value.trim();
  if (!decision) return toast('Write the decision first');
  button.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(state.selectedId)}/decisions`, {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('decisionTitle').value,
        decision,
        reason: document.getElementById('decisionReason').value
      })
    });
    toast('Decision recorded');
    await loadProjects(false);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function switchView(viewName) {
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.getElementById(`${viewName}View`).classList.add('active');
  const titles = { mission: 'Mission Control', brain: 'Project Brain', systems: 'Factory Systems' };
  els.pageTitle.textContent = titles[viewName] || 'AI Factory';
  els.sidebar.classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  state.filter = button.dataset.filter;
  renderProjects();
}));

function handleProjectActivation(event) {
  const card = event.target.closest('[data-project]');
  if (card) openDrawer(card.dataset.project);
}

els.projectGrid.addEventListener('click', handleProjectActivation);
els.brainList.addEventListener('click', handleProjectActivation);
els.projectGrid.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) handleProjectActivation(event); });
els.brainList.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) handleProjectActivation(event); });
els.syncButton.addEventListener('click', () => loadProjects(true));
els.closeDrawer.addEventListener('click', closeDrawer);
els.drawerBackdrop.addEventListener('click', closeDrawer);
els.mobileMenu.addEventListener('click', () => els.sidebar.classList.toggle('open'));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });

loadProjects(false);
