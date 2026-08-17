'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROJECTS_FILE = process.env.PROJECTS_FILE || path.join(ROOT, 'data', 'projects.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const WRITE_KEY = process.env.AI_FACTORY_KEY || '';
const CACHE_TTL_MS = Number(process.env.GITHUB_CACHE_TTL_MS || 120000);
const cache = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function cleanString(value, max = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanList(value, maxItems = 20, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function daysSince(dateString) {
  if (!dateString) return null;
  const then = new Date(dateString).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

function activityStatus(snapshot) {
  if (!snapshot || snapshot.error) return 'unavailable';
  const age = daysSince(snapshot.pushedAt);
  if (age === null) return 'unknown';
  if (age <= 3) return 'active';
  if (age <= 14) return 'warm';
  return 'stale';
}

async function readStore() {
  const raw = await fsp.readFile(PROJECTS_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.projects)) throw new Error('Project store is malformed.');
  return data;
}

async function writeStore(data) {
  const temp = `${PROJECTS_FILE}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fsp.rename(temp, PROJECTS_FILE);
}

function writeAllowed(req) {
  if (!WRITE_KEY) return true;
  return req.headers['x-ai-factory-key'] === WRITE_KEY;
}

async function githubFetch(apiPath) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'AI-Factory-Mission-Control',
    'x-github-api-version': '2022-11-28'
  };
  if (GITHUB_TOKEN) headers.authorization = `Bearer ${GITHUB_TOKEN}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.github.com${apiPath}`, {
      headers,
      signal: controller.signal
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (!response.ok) {
      let detail = `GitHub returned ${response.status}`;
      try {
        const body = await response.json();
        if (body.message) detail = body.message;
      } catch (_) {}
      const error = new Error(detail);
      error.status = response.status;
      error.rateLimitRemaining = remaining;
      error.rateLimitReset = reset;
      throw error;
    }
    return {
      data: await response.json(),
      rateLimitRemaining: remaining,
      rateLimitReset: reset
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRepoSnapshot(repo, force = false) {
  const cached = cache.get(repo);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const [owner, name] = repo.split('/');
  if (!owner || !name) return { repo, error: 'Invalid repository name.' };

  try {
    const metaResult = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    const meta = metaResult.data;
    let latestCommit = null;
    let build = { status: 'not-checked', conclusion: null, name: null, url: null };

    try {
      const commitResult = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=1`);
      const commit = commitResult.data[0];
      if (commit) {
        latestCommit = {
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 7),
          message: String(commit.commit?.message || '').split('\n')[0].slice(0, 160),
          date: commit.commit?.committer?.date || commit.commit?.author?.date || null,
          author: commit.commit?.author?.name || commit.author?.login || 'Unknown',
          url: commit.html_url
        };
      }
    } catch (_) {
      // Repository metadata is still useful even when commit history cannot be read.
    }

    if (GITHUB_TOKEN) {
      try {
        const runResult = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs?per_page=1`);
        const run = runResult.data.workflow_runs?.[0];
        if (run) {
          build = {
            status: run.status || 'unknown',
            conclusion: run.conclusion || null,
            name: run.name || null,
            url: run.html_url || null
          };
        } else {
          build = { status: 'no-runs', conclusion: null, name: null, url: null };
        }
      } catch (_) {
        build = { status: 'unavailable', conclusion: null, name: null, url: null };
      }
    }

    const value = {
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
      rateLimitRemaining: metaResult.rateLimitRemaining,
      authenticated: Boolean(GITHUB_TOKEN)
    };
    value.activity = activityStatus(value);
    cache.set(repo, { at: Date.now(), value });
    return value;
  } catch (error) {
    const value = {
      repo,
      error: error.status === 404 && !GITHUB_TOKEN
        ? 'Repository is private or unavailable. Add GITHUB_TOKEN to read private repositories.'
        : error.message,
      status: error.status || null,
      activity: 'unavailable',
      authenticated: Boolean(GITHUB_TOKEN),
      rateLimitRemaining: error.rateLimitRemaining || null,
      rateLimitReset: error.rateLimitReset || null
    };
    cache.set(repo, { at: Date.now(), value });
    return value;
  }
}

async function enrichProject(project, force = false) {
  const github = await fetchRepoSnapshot(project.repo, force);
  return { ...project, github };
}

async function getProjects(force = false) {
  const data = await readStore();
  const projects = await Promise.all(data.projects.map(project => enrichProject(project, force)));
  return projects;
}

function makeSummary(projects) {
  const attention = projects.filter(project => {
    const activity = project.github?.activity;
    return activity === 'stale' || activity === 'unavailable' || (project.brain?.blockers || []).length > 0;
  }).length;
  const active = projects.filter(project => ['active', 'warm'].includes(project.github?.activity)).length;
  const blockers = projects.reduce((total, project) => total + (project.brain?.blockers || []).length, 0);
  const buildsFailing = projects.filter(project => project.github?.build?.conclusion === 'failure').length;
  return {
    total: projects.length,
    active,
    attention,
    blockers,
    buildsFailing,
    lastSynced: new Date().toISOString(),
    githubAuthenticated: Boolean(GITHUB_TOKEN)
  };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(new Error('Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function updateBrain(id, input) {
  const store = await readStore();
  const project = store.projects.find(item => item.id === id);
  if (!project) return null;
  project.brain = project.brain || { currentState: '', nextActions: [], blockers: [], decisions: [] };

  if (Object.hasOwn(input, 'currentState')) project.brain.currentState = cleanString(input.currentState, 5000);
  if (Object.hasOwn(input, 'nextActions')) project.brain.nextActions = cleanList(input.nextActions);
  if (Object.hasOwn(input, 'blockers')) project.brain.blockers = cleanList(input.blockers);
  await writeStore(store);
  return project;
}

async function addDecision(id, input) {
  const store = await readStore();
  const project = store.projects.find(item => item.id === id);
  if (!project) return null;
  const title = cleanString(input.title, 200);
  const decision = cleanString(input.decision, 2000);
  const reason = cleanString(input.reason, 2000);
  if (!decision) throw new Error('Decision is required.');
  project.brain = project.brain || { currentState: '', nextActions: [], blockers: [], decisions: [] };
  project.brain.decisions = Array.isArray(project.brain.decisions) ? project.brain.decisions : [];
  const record = {
    date: new Date().toISOString().slice(0, 10),
    title: title || 'Decision',
    decision,
    reason
  };
  project.brain.decisions.unshift(record);
  project.brain.decisions = project.brain.decisions.slice(0, 100);
  await writeStore(store);
  return record;
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    const type = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
    sendJson(res, 404, { error: 'Not found' });
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      service: 'ai-factory',
      version: '0.1.0',
      githubAuthenticated: Boolean(GITHUB_TOKEN),
      writeProtected: Boolean(WRITE_KEY)
    });
  }

  if (pathname === '/api/projects' && req.method === 'GET') {
    const projects = await getProjects(url.searchParams.get('refresh') === '1');
    return sendJson(res, 200, { summary: makeSummary(projects), projects });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === 'GET') {
    const id = decodeURIComponent(projectMatch[1]);
    const store = await readStore();
    const project = store.projects.find(item => item.id === id);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });
    return sendJson(res, 200, await enrichProject(project, url.searchParams.get('refresh') === '1'));
  }

  const brainMatch = pathname.match(/^\/api\/projects\/([^/]+)\/brain$/);
  if (brainMatch && req.method === 'PUT') {
    if (!writeAllowed(req)) return sendJson(res, 401, { error: 'Write key required.' });
    const body = await readBody(req);
    const project = await updateBrain(decodeURIComponent(brainMatch[1]), body);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });
    return sendJson(res, 200, { ok: true, project });
  }

  const decisionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/decisions$/);
  if (decisionMatch && req.method === 'POST') {
    if (!writeAllowed(req)) return sendJson(res, 401, { error: 'Write key required.' });
    const body = await readBody(req);
    const decision = await addDecision(decodeURIComponent(decisionMatch[1]), body);
    if (!decision) return sendJson(res, 404, { error: 'Project not found.' });
    return sendJson(res, 201, { ok: true, decision });
  }

  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'API route not found.' });
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });
  return serveStatic(req, res, pathname);
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch(error => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: error.message || 'Internal server error.' });
      else res.end();
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`AI Factory Mission Control running on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  createServer,
  activityStatus,
  daysSince,
  cleanList,
  cleanString,
  makeSummary
};
