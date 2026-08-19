import core from './worker.js';

const encoder = new TextEncoder();

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } });
}

function cleanString(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanList(value, maxItems = 30, maxLength = 1000) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function safeParse(value, fallback = {}) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function safeEqual(provided, expected) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided || '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected || ''))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function authorized(request, env) {
  const expected = env.FACTORY_WRITE_TOKEN || env.AI_FACTORY_KEY || '';
  if (!expected) return false;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const provided = bearer || request.headers.get('x-ai-factory-key') || '';
  return provided ? safeEqual(provided, expected) : false;
}

async function ensureOrchestrationSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS factory_work_orders (
      id TEXT PRIMARY KEY,
      recommendation_id TEXT NOT NULL DEFAULT '',
      project_id TEXT,
      project_name TEXT NOT NULL DEFAULT '',
      repository TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL,
      constraints_json TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      authority_json TEXT NOT NULL DEFAULT '{}',
      source_json TEXT NOT NULL DEFAULT '{}',
      plan_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      result_json TEXT NOT NULL DEFAULT '{}',
      callback_status TEXT NOT NULL DEFAULT 'not_sent',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_factory_work_orders_status ON factory_work_orders(status, created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS factory_work_order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_factory_work_order_events ON factory_work_order_events(work_order_id, id DESC)`)
  ]);
}

function buildPlan(workOrder) {
  const text = `${workOrder.objective || ''} ${workOrder.repository || ''} ${(workOrder.constraints || []).join(' ')} ${(workOrder.acceptanceCriteria || []).join(' ')}`.toLowerCase();
  const capabilities = [];
  const add = (capability, reason) => {
    if (!capabilities.some((item) => item.capability === capability)) capabilities.push({ capability, reason });
  };

  if (/research|investigat|benchmark|compare|validate|evidence|market|opportunit/.test(text)) add('research', 'Objective requires evidence gathering or comparison.');
  if (/ui|ux|design|screen|layout|visual|prototype/.test(text)) add('designlab', 'Objective contains product design or UX work.');
  if (workOrder.repository || /code|implement|build|fix|bug|refactor|api|backend|frontend|database|auth|integration/.test(text)) add('engineering', 'Objective changes or investigates a software repository.');
  if (/security|permission|secret|token|auth|vulnerab/.test(text)) add('security-review', 'Objective touches security-sensitive behavior.');
  if (/apk|android|release|deploy|production|cloudflare|hosting/.test(text)) add('release-factory', 'Objective touches build, release or deployment.');
  add('verification', 'Every work order must prove its acceptance criteria before completion.');

  return {
    version: 1,
    mode: 'planned-not-autostarted',
    capabilities,
    steps: capabilities.map((item, index) => ({
      order: index + 1,
      capability: item.capability,
      action: item.capability === 'verification'
        ? 'Run acceptance checks and collect evidence.'
        : `Route the relevant part of the objective to ${item.capability}.`
    })),
    safety: {
      isolatedWorkRequired: true,
      mergeAllowed: false,
      productionDeployAllowed: false
    }
  };
}

function rowToWorkOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    projectId: row.project_id,
    projectName: row.project_name,
    repository: row.repository,
    objective: row.objective,
    constraints: safeParse(row.constraints_json, []),
    acceptanceCriteria: safeParse(row.acceptance_criteria_json, []),
    authority: safeParse(row.authority_json, {}),
    source: safeParse(row.source_json, {}),
    plan: safeParse(row.plan_json, {}),
    status: row.status,
    result: safeParse(row.result_json, {}),
    callbackStatus: row.callback_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

async function logEvent(db, workOrderId, eventType, detail = {}) {
  await db.prepare('INSERT INTO factory_work_order_events (work_order_id,event_type,detail_json,created_at) VALUES (?,?,?,?)')
    .bind(workOrderId, eventType, JSON.stringify(detail), new Date().toISOString()).run();
}

async function reportToOs(env, db, payload) {
  if (!env.OS_RESULT_URL || !env.OS_RESULT_TOKEN) return { sent: false, reason: 'OS callback is not configured' };
  try {
    const response = await fetch(env.OS_RESULT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OS_RESULT_TOKEN}`
      },
      body: JSON.stringify(payload)
    });
    const responseBody = await response.json().catch(() => ({}));
    const callbackStatus = response.ok ? 'sent' : `failed:${response.status}`;
    await db.prepare('UPDATE factory_work_orders SET callback_status=?,updated_at=? WHERE id=?')
      .bind(callbackStatus, new Date().toISOString(), payload.workOrderId).run();
    return { sent: response.ok, status: response.status, response: responseBody };
  } catch (error) {
    const message = error?.message || String(error);
    await db.prepare('UPDATE factory_work_orders SET callback_status=?,updated_at=? WHERE id=?')
      .bind(`failed:${message}`.slice(0, 250), new Date().toISOString(), payload.workOrderId).run();
    return { sent: false, error: message };
  }
}

async function receiveWorkOrder(request, env, ctx) {
  if (!(await authorized(request, env))) return json({ error: 'Factory write token required.' }, env.FACTORY_WRITE_TOKEN || env.AI_FACTORY_KEY ? 401 : 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON.' }, 400);

  const id = cleanString(body.id, 200);
  const objective = cleanString(body.objective, 8000);
  if (!id || !objective) return json({ error: 'id and objective are required.' }, 400);
  if (body.authority?.mayMerge === true || body.authority?.mayDeployProduction === true) {
    return json({ error: 'Machine-issued work orders may not grant merge or production deployment authority.' }, 400);
  }

  const workOrder = {
    id,
    recommendationId: cleanString(body.recommendationId, 200),
    projectId: cleanString(body.projectId, 200) || null,
    projectName: cleanString(body.projectName, 300),
    repository: cleanString(body.repository, 500),
    objective,
    constraints: cleanList(body.constraints),
    acceptanceCriteria: cleanList(body.acceptanceCriteria),
    authority: {
      mayCreateBranch: body.authority?.mayCreateBranch !== false,
      mayOpenPullRequest: body.authority?.mayOpenPullRequest !== false,
      mayMerge: false,
      mayDeployProduction: false
    },
    source: body.source && typeof body.source === 'object' ? body.source : {}
  };
  const plan = buildPlan(workOrder);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO factory_work_orders
    (id,recommendation_id,project_id,project_name,repository,objective,constraints_json,acceptance_criteria_json,authority_json,source_json,plan_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)`)
    .bind(
      workOrder.id, workOrder.recommendationId, workOrder.projectId, workOrder.projectName, workOrder.repository, workOrder.objective,
      JSON.stringify(workOrder.constraints), JSON.stringify(workOrder.acceptanceCriteria), JSON.stringify(workOrder.authority), JSON.stringify(workOrder.source), JSON.stringify(plan), now, now
    ).run();
  const duplicate = !result.meta?.changes;
  if (!duplicate) {
    await logEvent(env.DB, id, 'received', { plan });
    ctx.waitUntil(reportToOs(env, env.DB, { workOrderId: id, status: 'queued', summary: 'AI Factory accepted and planned the work order.' }));
  }
  const row = await env.DB.prepare('SELECT * FROM factory_work_orders WHERE id=?').bind(id).first();
  return json({ ok: true, jobId: id, duplicate, status: row?.status || 'queued', plan: safeParse(row?.plan_json, plan) }, duplicate ? 200 : 201);
}

async function transitionWorkOrder(request, env, id, action) {
  if (!(await authorized(request, env))) return json({ error: 'Factory write token required.' }, 401);
  const row = await env.DB.prepare('SELECT * FROM factory_work_orders WHERE id=?').bind(id).first();
  if (!row) return json({ error: 'Work order not found.' }, 404);
  const now = new Date().toISOString();

  if (action === 'start') {
    if (!['queued', 'blocked'].includes(row.status)) return json({ error: `Cannot start a ${row.status} work order.` }, 409);
    await env.DB.prepare("UPDATE factory_work_orders SET status='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?").bind(now, now, id).run();
    await logEvent(env.DB, id, 'running');
    const callback = await reportToOs(env, env.DB, { workOrderId: id, status: 'running', summary: 'AI Factory execution started.' });
    return json({ ok: true, workOrderId: id, status: 'running', callback });
  }

  const body = await request.json().catch(() => ({}));
  const status = cleanString(body.status, 30);
  if (!['completed', 'failed', 'blocked'].includes(status)) return json({ error: 'Result status must be completed, failed or blocked.' }, 400);
  const summary = cleanString(body.summary, 8000);
  const resultPayload = {
    summary,
    branch: cleanString(body.branch, 500) || null,
    pullRequestUrl: cleanString(body.pullRequestUrl, 1500) || null,
    artifacts: Array.isArray(body.artifacts) ? body.artifacts.slice(0, 50) : [],
    metrics: body.metrics && typeof body.metrics === 'object' ? body.metrics : {},
    evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 100) : [],
    error: cleanString(body.error, 8000) || null
  };
  const completedAt = status === 'completed' || status === 'failed' ? now : null;
  await env.DB.prepare('UPDATE factory_work_orders SET status=?,result_json=?,completed_at=?,updated_at=? WHERE id=?')
    .bind(status, JSON.stringify(resultPayload), completedAt, now, id).run();
  await logEvent(env.DB, id, status, resultPayload);
  const callback = await reportToOs(env, env.DB, { workOrderId: id, status, ...resultPayload });
  return json({ ok: true, workOrderId: id, status, callback });
}

async function handleOrchestration(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/work-orders') && path !== '/api/orchestration/status') return null;
  await ensureOrchestrationSchema(env.DB);

  if (path === '/api/work-orders' && request.method === 'POST') return receiveWorkOrder(request, env, ctx);
  if (path === '/api/work-orders' && request.method === 'GET') {
    if (!(await authorized(request, env))) return json({ error: 'Factory write token required.' }, 401);
    const status = url.searchParams.get('status');
    const result = status
      ? await env.DB.prepare('SELECT * FROM factory_work_orders WHERE status=? ORDER BY created_at DESC LIMIT 100').bind(status).all()
      : await env.DB.prepare('SELECT * FROM factory_work_orders ORDER BY created_at DESC LIMIT 100').all();
    return json({ workOrders: (result.results || []).map(rowToWorkOrder) });
  }

  if (path === '/api/orchestration/status' && request.method === 'GET') {
    if (!(await authorized(request, env))) return json({ error: 'Factory write token required.' }, 401);
    const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM factory_work_orders WHERE status='queued') AS queued,
      (SELECT COUNT(*) FROM factory_work_orders WHERE status='running') AS running,
      (SELECT COUNT(*) FROM factory_work_orders WHERE status='blocked') AS blocked,
      (SELECT COUNT(*) FROM factory_work_orders WHERE status='completed') AS completed,
      (SELECT COUNT(*) FROM factory_work_orders WHERE status='failed') AS failed`).first();
    return json({
      role: 'execution-engine',
      authority: { decideStrategy: false, mayMergeAutomatically: false, mayDeployProductionAutomatically: false },
      osCallbackConfigured: Boolean(env.OS_RESULT_URL && env.OS_RESULT_TOKEN),
      counts: counts || {}
    });
  }

  const getMatch = path.match(/^\/api\/work-orders\/([^/]+)$/);
  if (getMatch && request.method === 'GET') {
    if (!(await authorized(request, env))) return json({ error: 'Factory write token required.' }, 401);
    const row = await env.DB.prepare('SELECT * FROM factory_work_orders WHERE id=?').bind(decodeURIComponent(getMatch[1]),).first();
    if (!row) return json({ error: 'Work order not found.' }, 404);
    const events = await env.DB.prepare('SELECT event_type,detail_json,created_at FROM factory_work_order_events WHERE work_order_id=? ORDER BY id DESC LIMIT 100').bind(row.id).all();
    return json({ workOrder: rowToWorkOrder(row), events: (events.results || []).map((event) => ({ type: event.event_type, detail: safeParse(event.detail_json, {}), createdAt: event.created_at })) });
  }

  const startMatch = path.match(/^\/api\/work-orders\/([^/]+)\/start$/);
  if (startMatch && request.method === 'POST') return transitionWorkOrder(request, env, decodeURIComponent(startMatch[1]), 'start');
  const resultMatch = path.match(/^\/api\/work-orders\/([^/]+)\/result$/);
  if (resultMatch && request.method === 'POST') return transitionWorkOrder(request, env, decodeURIComponent(resultMatch[1]), 'result');
  return json({ error: 'Orchestration route not found.' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const handled = await handleOrchestration(request, env, ctx);
    if (handled) return handled;
    return core.fetch(request, env, ctx);
  }
};
