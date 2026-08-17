const CACHE_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

const PROJECT_SEEDS = [
  {
    id: 'ai-factory', name: 'AI Factory', repo: 'simplebusiness26/AI-Factory',
    purpose: 'Central operating system for projects, agents, decisions, health and releases.', stage: 'MVP',
    currentState: 'Mission Control + Project Brain MVP is being moved onto Cloudflare Workers + D1.',
    nextActions: ['Deploy the Cloudflare MVP', 'Connect project health and build signals', 'Add Watchtower and Release Factory after the core is stable'], blockers: []
  },
  {
    id: 'xplorer', name: 'Xplorer', repo: 'simplebusiness26/The-App',
    purpose: 'Social discovery, planning and real-world activity app.', stage: 'Active build',
    currentState: 'Core product is under active feature, UX and design development.',
    nextActions: ['Keep functionality and design work aligned with the actual app', 'Surface build/test health in Mission Control'], blockers: []
  },
  {
    id: 'livepark', name: 'LivePark', repo: 'simplebusiness26/LivePark',
    purpose: 'Real-time parking marketplace with live availability and booking.', stage: 'MVP',
    currentState: 'MVP development and deployment hardening are active.',
    nextActions: ['Surface APK/build health', 'Track infrastructure and database readiness'], blockers: []
  },
  {
    id: 'clipmine', name: 'ClipMine', repo: 'simplebusiness26/ClipMine',
    purpose: 'Turn long videos or URLs into short-form social clips.', stage: 'MVP',
    currentState: 'Processing pipeline, hosting and product completion are the active focus.',
    nextActions: ['Track backend deployment readiness', 'Track URL ingest and upload support'], blockers: []
  },
  {
    id: 'designlab', name: 'DesignLab', repo: 'simplebusiness26/DesignLab',
    purpose: 'Code-aware UI/UX tournament that produces functional design variants.', stage: 'Active build',
    currentState: 'Design tournament architecture and cost-efficient model routing are being refined.',
    nextActions: ['Keep design variants tied to real functionality', 'Reduce expensive model usage without reducing final quality'], blockers: []
  },
  {
    id: 'devcouncil', name: 'DevCouncil', repo: 'simplebusiness26/DevCouncil-',
    purpose: 'Specialist engineering agents coordinated by a lead engineering agent.', stage: 'Foundation',
    currentState: 'Lead-agent and specialist-agent foundations are being developed.',
    nextActions: ['Connect DevCouncil into AI Factory as the engineering department'], blockers: []
  },
  {
    id: 'ghost-writer', name: 'The Ghost Writer', repo: 'simplebusiness26/TheGhostWriter',
    purpose: 'Agentic content system that turns source material and knowledge into platform-ready content.', stage: 'Foundation',
    currentState: 'Agent workflow is being built as a working internal system first.',
    nextActions: ['Connect future Knowledge Mine outputs into the writing workflow'], blockers: []
  }
];

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' }
  });
}

function cleanString(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanList(value, maxItems = 20, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function daysSince(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function activityStatus(snapshot) {
  if (!snapshot || snapshot.error) return 'unavailable';
  const age = daysSince(snapshot.pushedAt);
  if (age === null) return 'unknown';
  if (age <= 3) return 'active';
  if (age <= 14) return 'warm';
  return 'stale';
}

async function ensureSchema(db) {
  const statements = [
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo TEXT NOT NULL,
      purpose TEXT NOT NULL,
      stage TEXT NOT NULL,
      current_state TEXT NOT NULL DEFAULT '',
      next_actions TEXT NOT NULL DEFAULT '[]',
      blockers TEXT NOT NULL DEFAULT '[]'
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, id DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS repo_cache (
      repo TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    )`)
  ];
  await db.batch(statements);

  const seedStatements = PROJECT_SEEDS.map((project) => db.prepare(`
    INSERT OR IGNORE INTO projects
      (id, name, repo, purpose, stage, current_state, next_actions, blockers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    project.id, project.name, project.repo, project.purpose, project.stage,
    project.currentState, JSON.stringify(project.nextActions), JSON.stringify(project.blockers)
  ));
  await db.batch(seedStatements);

  await db.prepare(`
    INSERT OR IGNORE INTO decisions (id, project_id, date, title, decision, reason)
    VALUES (1, 'ai-factory', '2026-08-17', 'Start with the central nervous system',
      'Build Mission Control + Project Brain before the rest of the factory systems.',
      'The other systems need one shared source of truth and control surface.')
  `).run();
}

async function readProjects(db) {
  const [projectResult, decisionResult] = await db.batch([
    db.prepare('SELECT * FROM projects ORDER BY rowid'),
    db.prepare('SELECT project_id, date, title, decision, reason FROM decisions ORDER BY id DESC')
  ]);
  const decisionsByProject = new Map();
  for (const item of decisionResult.results || []) {
    if (!decisionsByProject.has(item.project_id)) decisionsByProject.set(item.project_id, []);
    decisionsByProject.get(item.project_id).push({
      date: item.date, title: item.title, decision: item.decision, reason: item.reason
    });
  }
  return (projectResult.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    repo: row.repo,
    purpose: row.purpose,
    stage: row.stage,
    brain: {
      currentState: row.current_state,
      nextActions: parseList(row.next_actions),
      blockers: parseList(row.blockers),
      decisions: decisionsByProject.get(row.id) || []
    }
  }));
}

async function githubRequest(path, env) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'AI-Factory-Mission-Control',
    'x-github-api-version': '2022-11-28'
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    let message = `GitHub returned ${response.status}`;
    try {
      const body = await response.json();
      if (body.message) message = body.message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function liveRepoSnapshot(repo, env) {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return { repo, error: 'Invalid repository name.', activity: 'unavailable' };
  try {
    const meta = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, env);
    let latestCommit = null;
    try {
      const commits = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=1`, env);
      const commit = commits?.[0];
      if (commit) {
        latestCommit = {
          sha: commit.sha,
          shortSha: String(commit.sha || '').slice(0, 7),
          message: String(commit.commit?.message || '').split('\n')[0].slice(0, 160),
          date: commit.commit?.committer?.date || commit.commit?.author?.date || null,
          author: commit.commit?.author?.name || commit.author?.login || 'Unknown',
          url: commit.html_url || null
        };
      }
    } catch {}

    let build = { status: 'not-checked', conclusion: null, name: null, url: null };
    if (env.GITHUB_TOKEN) {
      try {
        const runs = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs?per_page=1`, env);
        const run = runs.workflow_runs?.[0];
        build = run ? {
          status: run.status || 'unknown', conclusion: run.conclusion || null,
          name: run.name || null, url: run.html_url || null
        } : { status: 'no-runs', conclusion: null, name: null, url: null };
      } catch {
        build = { status: 'unavailable', conclusion: null, name: null, url: null };
      }
    }

    const snapshot = {
      repo,
      fullName: meta.full_name,
      url: meta.html_url,
      visibility: meta.visibility || (meta.private ? 'private' : 'public'),
      defaultBranch: meta.default_branch,
      pushedAt: meta.pushed_at,
      updatedAt: meta.updated_at,
      openItems: meta.open_issues_count || 0,
      archived: Boolean(meta.archived),
      latestCommit,
      build,
      authenticated: Boolean(env.GITHUB_TOKEN)
    };
    snapshot.activity = activityStatus(snapshot);
    return snapshot;
  } catch (error) {
    return {
      repo,
      error: error.status === 404 && !env.GITHUB_TOKEN
        ? 'Repository is private or unavailable. Add GITHUB_TOKEN to read private repositories.'
        : error.message,
      status: error.status || null,
      activity: 'unavailable',
      authenticated: Boolean(env.GITHUB_TOKEN)
    };
  }
}

async function enrichProjects(projects, db, env, force = false) {
  const cacheResult = await db.prepare('SELECT repo, snapshot, cached_at FROM repo_cache').all();
  const cache = new Map((cacheResult.results || []).map((row) => [row.repo, row]));
  const now = Date.now();
  const freshSnapshots = [];

  const enriched = await Promise.all(projects.map(async (project) => {
    const cached = cache.get(project.repo);
    if (!force && cached && now - Number(cached.cached_at) < CACHE_TTL_MS) {
      try { return { ...project, github: JSON.parse(cached.snapshot) }; } catch {}
    }
    const github = await liveRepoSnapshot(project.repo, env);
    freshSnapshots.push({ repo: project.repo, github });
    return { ...project, github };
  }));

  if (freshSnapshots.length) {
    await db.batch(freshSnapshots.map(({ repo, github }) => db.prepare(`
      INSERT INTO repo_cache (repo, snapshot, cached_at) VALUES (?, ?, ?)
      ON CONFLICT(repo) DO UPDATE SET snapshot = excluded.snapshot, cached_at = excluded.cached_at
    `).bind(repo, JSON.stringify(github), now)));
  }
  return enriched;
}

function makeSummary(projects, env) {
  return {
    total: projects.length,
    active: projects.filter((p) => ['active', 'warm'].includes(p.github?.activity)).length,
    attention: projects.filter((p) => ['stale', 'unavailable'].includes(p.github?.activity) || (p.brain?.blockers || []).length > 0).length,
    blockers: projects.reduce((sum, p) => sum + (p.brain?.blockers || []).length, 0),
    buildsFailing: projects.filter((p) => p.github?.build?.conclusion === 'failure').length,
    lastSynced: new Date().toISOString(),
    githubAuthenticated: Boolean(env.GITHUB_TOKEN)
  };
}

async function safeEqual(provided, expected) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided || '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected || ''))
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function requireWriteAccess(request, env) {
  if (!env.AI_FACTORY_KEY) {
    return json({ error: 'Project Brain writes are locked until AI_FACTORY_KEY is configured in Cloudflare.' }, 503);
  }
  const provided = request.headers.get('x-ai-factory-key') || '';
  if (!(await safeEqual(provided, env.AI_FACTORY_KEY))) {
    return json({ error: 'Write key required.' }, 401);
  }
  return null;
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('JSON body required.');
  return request.json();
}

async function handleApi(request, env) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/health' && request.method === 'GET') {
    return json({
      ok: true,
      service: 'ai-factory',
      version: '0.2.0-cloudflare',
      runtime: 'cloudflare-workers',
      database: 'd1',
      githubAuthenticated: Boolean(env.GITHUB_TOKEN),
      writeProtected: Boolean(env.AI_FACTORY_KEY)
    });
  }

  if (path === '/api/projects' && request.method === 'GET') {
    const projects = await readProjects(env.DB);
    const enriched = await enrichProjects(projects, env.DB, env, url.searchParams.get('refresh') === '1');
    return json({ summary: makeSummary(enriched, env), projects: enriched });
  }

  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && request.method === 'GET') {
    const projects = await readProjects(env.DB);
    const project = projects.find((item) => item.id === decodeURIComponent(projectMatch[1]));
    if (!project) return json({ error: 'Project not found.' }, 404);
    const [enriched] = await enrichProjects([project], env.DB, env, url.searchParams.get('refresh') === '1');
    return json(enriched);
  }

  const brainMatch = path.match(/^\/api\/projects\/([^/]+)\/brain$/);
  if (brainMatch && request.method === 'PUT') {
    const denied = await requireWriteAccess(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(brainMatch[1]);
    const body = await readJson(request);
    const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
    if (!existing) return json({ error: 'Project not found.' }, 404);
    await env.DB.prepare(`
      UPDATE projects SET current_state = ?, next_actions = ?, blockers = ? WHERE id = ?
    `).bind(
      cleanString(body.currentState, 5000),
      JSON.stringify(cleanList(body.nextActions)),
      JSON.stringify(cleanList(body.blockers)),
      id
    ).run();
    return json({ ok: true });
  }

  const decisionMatch = path.match(/^\/api\/projects\/([^/]+)\/decisions$/);
  if (decisionMatch && request.method === 'POST') {
    const denied = await requireWriteAccess(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(decisionMatch[1]);
    const body = await readJson(request);
    const decision = cleanString(body.decision, 2000);
    if (!decision) return json({ error: 'Decision is required.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
    if (!existing) return json({ error: 'Project not found.' }, 404);
    const record = {
      date: new Date().toISOString().slice(0, 10),
      title: cleanString(body.title, 200) || 'Decision',
      decision,
      reason: cleanString(body.reason, 2000)
    };
    await env.DB.prepare(`
      INSERT INTO decisions (project_id, date, title, decision, reason) VALUES (?, ?, ?, ?, ?)
    `).bind(id, record.date, record.title, record.decision, record.reason).run();
    return json({ ok: true, decision: record }, 201);
  }

  return json({ error: 'API route not found.' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_error', message: error?.message || String(error) }));
      return json({ error: error?.message || 'Internal server error.' }, 500);
    }
  }
};
