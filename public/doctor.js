'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const doctorButton = document.querySelector('[data-view="doctor"]');
  const runButton = byId('runDoctor');
  const keyButton = byId('doctorWriteKey');
  const copyButton = byId('copyDoctorReport');
  const statusEl = byId('doctorOverall');
  const summaryEl = byId('doctorSummary');
  const checksEl = byId('doctorChecks');
  const nextEl = byId('doctorNext');
  const hostEl = byId('doctorHost');

  if (!doctorButton || !checksEl) return;

  let latestReport = null;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function makeCheck(id, label, status, detail, fix = '') {
    return { id, label, status, detail, fix };
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.headers || {})
      }
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    return { ok: response.ok, status: response.status, payload };
  }

  function currentKey() {
    return sessionStorage.getItem('aiFactoryKey') || '';
  }

  function routeCheck() {
    const host = location.hostname;
    const protocol = location.protocol;
    if (!host) return makeCheck('route', 'Public route', 'fail', 'No hostname is available.', 'Open AI Factory from its Cloudflare URL.');
    if (!['https:', 'http:'].includes(protocol)) return makeCheck('route', 'Public route', 'fail', `Unsupported protocol: ${protocol}`, 'Use the HTTPS Cloudflare Worker URL.');
    if (protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') {
      return makeCheck('route', 'Public route', 'warn', `${host} is reachable but is not using HTTPS.`, 'Use the HTTPS Worker URL.');
    }
    const routeType = host.endsWith('.workers.dev') ? 'Cloudflare workers.dev route' : 'custom/preview route';
    return makeCheck('route', 'Public route', 'pass', `${routeType} is serving this page at ${host}.`);
  }

  async function runDoctor() {
    runButton && (runButton.disabled = true);
    if (runButton) runButton.textContent = 'RUNNING…';
    checksEl.innerHTML = '<div class="doctor-loading">Running factory checks…</div>';
    nextEl && (nextEl.innerHTML = '');

    const checks = [routeCheck()];
    const key = currentKey();

    let health;
    try {
      health = await fetchJson('/api/health');
      if (health.ok && health.payload?.ok === true) {
        checks.push(makeCheck('worker', 'Worker API', 'pass', `${health.payload.runtime || 'Worker'} responded successfully.`));
        checks.push(makeCheck('d1-binding', 'D1 binding', health.payload.database === 'd1' ? 'pass' : 'warn', health.payload.database === 'd1' ? 'Worker reports D1 as its database.' : `Worker reports database: ${health.payload.database || 'unknown'}.`, 'Check the DB binding in Cloudflare if this is not D1.'));
        checks.push(makeCheck('write-config', 'AI_FACTORY_KEY', health.payload.writeProtected ? 'pass' : 'warn', health.payload.writeProtected ? 'Write protection is configured in Cloudflare.' : 'AI_FACTORY_KEY is not configured, so protected writes and the Ghost Writer Bridge stay locked.', 'Cloudflare → ai-factory → Settings → Variables and Secrets → add secret AI_FACTORY_KEY, then deploy.'));
        checks.push(makeCheck('github-mode', 'GitHub authentication', health.payload.githubAuthenticated ? 'pass' : 'warn', health.payload.githubAuthenticated ? 'GITHUB_TOKEN is active.' : 'Running in GitHub public mode. Public repositories work, but private repos/full Actions data may not.', 'Optional: add a read-only fine-grained GITHUB_TOKEN in Cloudflare.'));
      } else {
        checks.push(makeCheck('worker', 'Worker API', 'fail', `/api/health returned HTTP ${health.status}.`, 'Open the latest Cloudflare deployment logs and check the Worker error.'));
      }
    } catch (error) {
      checks.push(makeCheck('worker', 'Worker API', 'fail', `Could not reach /api/health: ${error.message}`, 'Check the Worker route and latest Cloudflare deployment.'));
    }

    let projects;
    try {
      projects = await fetchJson('/api/projects');
      if (projects.ok && Array.isArray(projects.payload?.projects)) {
        const repoErrors = projects.payload.projects.filter((p) => p.github?.error).length;
        checks.push(makeCheck('d1-runtime', 'D1 + Project Brain', 'pass', `${projects.payload.projects.length} projects loaded through D1.`));
        checks.push(makeCheck('github-read', 'GitHub repository reads', repoErrors === 0 ? 'pass' : 'warn', repoErrors === 0 ? 'Tracked repositories returned GitHub data.' : `${repoErrors} tracked project${repoErrors === 1 ? '' : 's'} could not return full GitHub data.`, 'Open Watchtower to see which repositories need attention; add GITHUB_TOKEN if private repos are involved.'));
      } else {
        checks.push(makeCheck('d1-runtime', 'D1 + Project Brain', 'fail', `/api/projects returned HTTP ${projects.status}.`, 'Check the D1 DB binding and Worker deployment logs.'));
      }
    } catch (error) {
      checks.push(makeCheck('d1-runtime', 'D1 + Project Brain', 'fail', `Project data could not load: ${error.message}`, 'Check the D1 DB binding and Worker logs.'));
    }

    const [decisions, knowledge] = await Promise.allSettled([
      fetchJson('/api/decisions'),
      fetchJson('/api/knowledge')
    ]);
    if (decisions.status === 'fulfilled' && decisions.value.ok) checks.push(makeCheck('decision-api', 'Decision Engine API', 'pass', 'Decision records endpoint is responding.'));
    else checks.push(makeCheck('decision-api', 'Decision Engine API', 'fail', 'Decision Engine endpoint failed.', 'Check Worker logs and D1 schema.'));
    if (knowledge.status === 'fulfilled' && knowledge.value.ok) checks.push(makeCheck('knowledge-api', 'Knowledge Mine API', 'pass', 'Knowledge records endpoint is responding.'));
    else checks.push(makeCheck('knowledge-api', 'Knowledge Mine API', 'fail', 'Knowledge Mine endpoint failed.', 'Check Worker logs and D1 schema.'));

    if (!health?.payload?.writeProtected) {
      checks.push(makeCheck('browser-key', 'Browser write-key session', 'warn', 'The server write key is not configured yet.', 'Add AI_FACTORY_KEY in Cloudflare first.'));
      checks.push(makeCheck('ghostwriter', 'Ghost Writer Bridge', 'warn', 'Bridge cannot be verified until AI_FACTORY_KEY is configured.', 'Configure AI_FACTORY_KEY, redeploy, then rerun Deployment Doctor.'));
    } else if (!key) {
      checks.push(makeCheck('browser-key', 'Browser write-key session', 'warn', 'AI_FACTORY_KEY exists in Cloudflare, but this browser session has not entered it yet.', 'Tap ENTER WRITE KEY on this screen.'));
      checks.push(makeCheck('ghostwriter', 'Ghost Writer Bridge', 'warn', 'Bridge is protected and has not been authenticated from this browser yet.', 'Tap ENTER WRITE KEY, then rerun Deployment Doctor.'));
    } else {
      try {
        const bridge = await fetchJson('/api/ghostwriter-bridge', { headers: { 'x-ai-factory-key': key } });
        if (bridge.ok) {
          const total = Number(bridge.payload?.summary?.total || 0);
          const queued = Number(bridge.payload?.summary?.queued || 0);
          checks.push(makeCheck('browser-key', 'Browser write-key session', 'pass', 'This browser can authenticate protected factory requests.'));
          checks.push(makeCheck('ghostwriter', 'Ghost Writer Bridge', 'pass', `Bridge is reachable. ${total} evidence packet${total === 1 ? '' : 's'} stored; ${queued} queued for Ghost Writer.`));
        } else if (bridge.status === 401) {
          checks.push(makeCheck('browser-key', 'Browser write-key session', 'fail', 'The saved browser write key does not match Cloudflare.', 'Tap ENTER WRITE KEY and enter the current AI_FACTORY_KEY.'));
          checks.push(makeCheck('ghostwriter', 'Ghost Writer Bridge', 'fail', 'Bridge rejected the current browser key.', 'Enter the correct write key, then rerun.'));
        } else {
          checks.push(makeCheck('ghostwriter', 'Ghost Writer Bridge', 'fail', `Bridge returned HTTP ${bridge.status}.`, 'Check Worker logs and the D1 bridge table.'));
        }
      } catch (error) {
        checks.push(makeCheck('ghostwriter', 'Ghost Writer Bridge', 'fail', `Bridge check failed: ${error.message}`, 'Check Worker logs and rerun after the route is stable.'));
      }
    }

    const failures = checks.filter((check) => check.status === 'fail');
    const warnings = checks.filter((check) => check.status === 'warn');
    const overall = failures.length ? 'broken' : warnings.length ? 'setup' : 'healthy';
    const firstAction = failures[0] || warnings[0] || null;

    latestReport = {
      generatedAt: new Date().toISOString(),
      host: location.host,
      overall,
      checks
    };

    renderReport(latestReport, firstAction);
    runButton && (runButton.disabled = false);
    if (runButton) runButton.textContent = 'RUN AGAIN';
  }

  function renderReport(report, firstAction) {
    const pass = report.checks.filter((c) => c.status === 'pass').length;
    const warn = report.checks.filter((c) => c.status === 'warn').length;
    const fail = report.checks.filter((c) => c.status === 'fail').length;

    if (hostEl) hostEl.textContent = report.host || '—';
    if (statusEl) {
      statusEl.className = `doctor-overall ${report.overall}`;
      statusEl.textContent = report.overall === 'healthy' ? 'HEALTHY' : report.overall === 'setup' ? 'NEEDS SETUP' : 'BROKEN';
    }
    if (summaryEl) summaryEl.innerHTML = `<div><strong>${pass}</strong><span>passing</span></div><div><strong>${warn}</strong><span>warnings</span></div><div><strong>${fail}</strong><span>failures</span></div>`;

    checksEl.innerHTML = report.checks.map((check) => `<article class="doctor-check ${escapeHtml(check.status)}"><span class="doctor-icon">${check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '×'}</span><div class="doctor-copy"><div class="doctor-check-top"><strong>${escapeHtml(check.label)}</strong><span>${escapeHtml(check.status)}</span></div><p>${escapeHtml(check.detail)}</p>${check.fix && check.status !== 'pass' ? `<div class="doctor-fix"><b>Fix:</b> ${escapeHtml(check.fix)}</div>` : ''}</div></article>`).join('');

    if (nextEl) {
      nextEl.innerHTML = firstAction
        ? `<strong>Do this next</strong><p>${escapeHtml(firstAction.fix || firstAction.detail)}</p>`
        : '<strong>Factory is ready</strong><p>All checks passed. No deployment setup action is currently required.</p>';
    }
  }

  function enterWriteKey() {
    const entered = window.prompt('Enter the AI Factory write key. It stays in this browser session and is not displayed in the repository:');
    if (!entered) return;
    sessionStorage.setItem('aiFactoryKey', entered.trim());
    runDoctor();
  }

  async function copyReport() {
    if (!latestReport) await runDoctor();
    if (!latestReport) return;
    const text = [
      `AI Factory Deployment Doctor — ${latestReport.overall.toUpperCase()}`,
      `Host: ${latestReport.host}`,
      `Generated: ${latestReport.generatedAt}`,
      '',
      ...latestReport.checks.map((check) => `[${check.status.toUpperCase()}] ${check.label}: ${check.detail}${check.status !== 'pass' && check.fix ? ` | Fix: ${check.fix}` : ''}`)
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'COPIED';
      setTimeout(() => { copyButton.textContent = 'COPY REPORT'; }, 1500);
    } catch {
      window.prompt('Copy this Deployment Doctor report:', text);
    }
  }

  doctorButton.addEventListener('click', () => {
    const title = byId('pageTitle');
    if (title) title.textContent = 'Deployment Doctor';
    runDoctor();
  });
  runButton?.addEventListener('click', runDoctor);
  keyButton?.addEventListener('click', enterWriteKey);
  copyButton?.addEventListener('click', copyReport);
})();
