const JSON_FIELDS = ['constraints_json','acceptance_json','authority_json','budget_json','execution_route_json','readiness_json','metrics_json','evidence_json','artifacts_json'];

export const CAPABILITY_SEEDS = [
  {
    id: 'factory-planner',
    name: 'Factory Planner',
    kind: 'orchestration',
    system: 'ai-factory',
    status: 'ready',
    readiness: 100,
    endpoint: null,
    notes: 'Deterministic work-order planning and execution routing inside AI Factory.'
  },
  {
    id: 'verification-core',
    name: 'Verification Core',
    kind: 'verification',
    system: 'ai-factory',
    status: 'ready',
    readiness: 100,
    endpoint: null,
    notes: 'Acceptance-criteria, build-state and evidence verification gate.'
  },
  {
    id: 'release-factory',
    name: 'Release Factory',
    kind: 'release',
    system: 'ai-factory',
    status: 'limited',
    readiness: 70,
    endpoint: null,
    notes: 'Can inspect builds/releases/APKs. Production deployment remains approval-gated.'
  },
  {
    id: 'ghost-writer',
    name: 'Ghost Writer Bridge',
    kind: 'content',
    system: 'the-ghost-writer',
    status: 'ready',
    readiness: 90,
    endpoint: '/api/ghostwriter-bridge',
    notes: 'Evidence bridge is connected. Publishing remains outside Factory authority.'
  },
  {
    id: 'devcouncil',
    name: 'DevCouncil',
    kind: 'engineering',
    system: 'devcouncil',
    status: 'not_ready',
    readiness: 35,
    endpoint: null,
    notes: 'Reserved as the engineering department. Needs a stable machine dispatch contract, isolated branch execution and structured result callback before automatic use.'
  },
  {
    id: 'designlab-v3',
    name: 'DesignLab V3',
    kind: 'design',
    system: 'designlab-v3',
    status: 'not_ready',
    readiness: 30,
    endpoint: null,
    notes: 'Factory target is DesignLab V3. Current DesignLabV2 repository must be upgraded with a machine work-order interface and result contract before automatic use.'
  },
  {
    id: 'deployment-gate',
    name: 'Production Deployment Gate',
    kind: 'deployment',
    system: 'ai-factory',
    status: 'approval_required',
    readiness: 100,
    endpoint: null,
    notes: 'Production deploy is intentionally blocked unless the Operating System work order explicitly grants authority.'
  }
];

function nowIso() {
  return new Date().toISOString();
}

function safeString(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeList(value, max = 50, itemMax = 1500) {
  return Array.isArray(value)
    ? value.map((item) => safeString(item, itemMax)).filter(Boolean).slice(0, max)
    : [];
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeAuthority(value = {}) {
  return {
    mayCreateBranch: value?.mayCreateBranch !== false,
    mayOpenPullRequest: value?.mayOpenPullRequest !== false,
    mayMerge: value?.mayMerge === true,
    mayDeployProduction: value?.mayDeployProduction === true,
    maySpend: value?.maySpend === true,
    mayExternalWrite: value?.mayExternalWrite === true
  };
}

export function normalizeWorkOrder(input = {}) {
  const id = safeString(input.id, 160) || randomId('work');
  const objective = safeString(input.objective, 5000);
  if (!objective) throw new Error('objective is required');
  return {
    id,
    recommendationId: safeString(input.recommendationId, 200) || null,
    sourceSystem: safeString(input.source?.system || input.sourceSystem, 120) || 'operating-system',
    sourceExternalId: safeString(input.source?.externalId || input.sourceExternalId, 300) || null,
    projectId: safeString(input.projectId, 200) || null,
    projectName: safeString(input.projectName, 300) || null,
    repository: safeString(input.repository, 500) || null,
    objective,
    constraints: safeList(input.constraints),
    acceptanceCriteria: safeList(input.acceptanceCriteria),
    authority: normalizeAuthority(input.authority),
    budget: {
      maxCost: Number.isFinite(Number(input.budget?.maxCost)) ? Number(input.budget.maxCost) : null,
      currency: safeString(input.budget?.currency, 10) || 'GBP',
      maxAttempts: Number.isFinite(Number(input.budget?.maxAttempts)) ? Math.max(1, Math.min(20, Number(input.budget.maxAttempts))) : 3
    },
    priority: Number.isFinite(Number(input.priority)) ? Math.max(1, Math.min(100, Number(input.priority))) : 60
  };
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function buildExecutionPlan(workOrder, capabilities = CAPABILITY_SEEDS) {
  const text = `${workOrder.objective} ${workOrder.constraints.join(' ')} ${workOrder.acceptanceCriteria.join(' ')}`.toLowerCase();
  const route = ['factory-planner'];
  const rationale = [];

  const designNeeded = includesAny(text, ['design', 'ux', 'ui ', 'interface', 'layout', 'prototype', 'visual', 'screen']);
  const engineeringNeeded = designNeeded || includesAny(text, ['build', 'implement', 'code', 'fix', 'bug', 'refactor', 'api', 'database', 'integration', 'feature', 'apk', 'website', 'app ']);
  const releaseNeeded = includesAny(text, ['release', 'apk', 'deploy', 'production', 'ship', 'publish']);
  const contentNeeded = includesAny(text, ['content', 'post', 'ghost writer', 'ghostwriter', 'document']);

  if (designNeeded) {
    route.push('designlab-v3');
    rationale.push('Design/UX/UI work detected, so DesignLab V3 is required before engineering acceptance.');
  }
  if (engineeringNeeded) {
    route.push('devcouncil');
    rationale.push('Engineering implementation is required, so DevCouncil is the intended engineering executor.');
  }
  if (contentNeeded) {
    route.push('ghost-writer');
    rationale.push('The work order contains a content/documentation requirement.');
  }

  route.push('verification-core');
  if (releaseNeeded) {
    route.push('release-factory');
    rationale.push('A build/release/deploy outcome is requested, so Release Factory must verify the artifact.');
    if (text.includes('deploy') || text.includes('production') || text.includes('publish')) route.push('deployment-gate');
  }

  const uniqueRoute = [...new Set(route)];
  const capabilityById = new Map(capabilities.map((item) => [item.id, item]));
  const readiness = uniqueRoute.map((id) => {
    const cap = capabilityById.get(id) || { id, name: id, status: 'missing', readiness: 0, notes: 'Capability is not registered.' };
    return {
      id,
      name: cap.name,
      status: cap.status,
      readiness: cap.readiness,
      notes: cap.notes
    };
  });
  const blockers = readiness
    .filter((item) => ['not_ready', 'missing'].includes(item.status))
    .map((item) => `${item.name}: ${item.notes}`);

  const deploymentRequested = uniqueRoute.includes('deployment-gate');
  if (deploymentRequested && !workOrder.authority.mayDeployProduction) {
    blockers.push('Production deployment was requested but the work order does not grant mayDeployProduction authority.');
  }

  return {
    route: uniqueRoute,
    rationale,
    readiness,
    blockers,
    dispatchable: blockers.length === 0,
    acceptanceCriteria: workOrder.acceptanceCriteria.length
      ? workOrder.acceptanceCriteria
      : ['Required executor reports a structured result', 'Verification Core records evidence for completion']
  };
}

export async function ensureFactoryV2Schema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS factory_capabilities (
      id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,system TEXT NOT NULL,status TEXT NOT NULL,
      readiness INTEGER NOT NULL DEFAULT 0,endpoint TEXT,notes TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,recommendation_id TEXT,source_system TEXT NOT NULL,source_external_id TEXT,project_id TEXT,project_name TEXT,
      repository TEXT,objective TEXT NOT NULL,constraints_json TEXT NOT NULL DEFAULT '[]',acceptance_json TEXT NOT NULL DEFAULT '[]',
      authority_json TEXT NOT NULL DEFAULT '{}',budget_json TEXT NOT NULL DEFAULT '{}',priority INTEGER NOT NULL DEFAULT 60,status TEXT NOT NULL DEFAULT 'queued',
      execution_route_json TEXT NOT NULL DEFAULT '[]',readiness_json TEXT NOT NULL DEFAULT '{}',current_step INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,summary TEXT NOT NULL DEFAULT '',branch TEXT,pull_request_url TEXT,result_reported_at TEXT,result_report_error TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,started_at TEXT,completed_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS execution_runs (
      id TEXT PRIMARY KEY,work_order_id TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'planned',
      route_json TEXT NOT NULL DEFAULT '[]',summary TEXT NOT NULL DEFAULT '',branch TEXT,pull_request_url TEXT,cost REAL,error TEXT,
      started_at TEXT,completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS execution_steps (
      id TEXT PRIMARY KEY,run_id TEXT NOT NULL,work_order_id TEXT NOT NULL,step_index INTEGER NOT NULL,capability_id TEXT NOT NULL,
      title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',input_json TEXT NOT NULL DEFAULT '{}',output_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,FOREIGN KEY(work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
      UNIQUE(run_id,step_index))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS verification_results (
      id TEXT PRIMARY KEY,work_order_id TEXT NOT NULL,criterion_index INTEGER NOT NULL,criterion TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
      evidence_json TEXT NOT NULL DEFAULT '[]',notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS factory_events (
      id TEXT PRIMARY KEY,work_order_id TEXT,event_type TEXT NOT NULL,detail_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status,priority DESC,created_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_runs_work_order ON execution_runs(work_order_id,attempt DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_steps_work_order ON execution_steps(work_order_id,step_index)`)
  ]);

  const at = nowIso();
  for (const cap of CAPABILITY_SEEDS) {
    await db.prepare(`INSERT INTO factory_capabilities (id,name,kind,system,status,readiness,endpoint,notes,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,system=excluded.system,
      status=CASE WHEN factory_capabilities.status IN ('ready','limited') AND excluded.status='not_ready' THEN factory_capabilities.status ELSE excluded.status END,
      readiness=CASE WHEN factory_capabilities.readiness>excluded.readiness THEN factory_capabilities.readiness ELSE excluded.readiness END,
      endpoint=COALESCE(factory_capabilities.endpoint,excluded.endpoint),notes=excluded.notes,updated_at=excluded.updated_at`)
      .bind(cap.id, cap.name, cap.kind, cap.system, cap.status, cap.readiness, cap.endpoint, cap.notes, at).run();
  }
}

async function readCapabilities(db) {
  const result = await db.prepare('SELECT * FROM factory_capabilities ORDER BY kind,name').all();
  return result.results || [];
}

function rowToWorkOrder(row) {
  if (!row) return null;
  const out = { ...row };
  for (const field of JSON_FIELDS) {
    if (field in out) {
      const name = field.replace(/_json$/, '');
      out[name] = parseJson(out[field], field.endsWith('authority_json') || field.endsWith('budget_json') || field.endsWith('readiness_json') ? {} : []);
      delete out[field];
    }
  }
  return out;
}

async function getWorkOrder(db, id) {
  return rowToWorkOrder(await db.prepare('SELECT * FROM work_orders WHERE id=?').bind(id).first());
}

async function insertEvent(db, workOrderId, eventType, detail = {}) {
  await db.prepare('INSERT INTO factory_events (id,work_order_id,event_type,detail_json,created_at) VALUES (?,?,?,?,?)')
    .bind(randomId('evt'), workOrderId, eventType, JSON.stringify(detail), nowIso()).run();
}

async function createWorkOrder(db, input) {
  const work = normalizeWorkOrder(input);
  const capabilities = await readCapabilities(db);
  const plan = buildExecutionPlan(work, capabilities);
  const at = nowIso();
  const status = plan.dispatchable ? 'queued' : 'blocked';
  const blockedReason = plan.blockers.join(' | ') || null;

  const existing = await getWorkOrder(db, work.id);
  if (existing) return { inserted: false, workOrder: existing };

  await db.prepare(`INSERT INTO work_orders (
    id,recommendation_id,source_system,source_external_id,project_id,project_name,repository,objective,constraints_json,acceptance_json,
    authority_json,budget_json,priority,status,execution_route_json,readiness_json,blocked_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(work.id,work.recommendationId,work.sourceSystem,work.sourceExternalId,work.projectId,work.projectName,work.repository,work.objective,
      JSON.stringify(work.constraints),JSON.stringify(plan.acceptanceCriteria),JSON.stringify(work.authority),JSON.stringify(work.budget),work.priority,status,
      JSON.stringify(plan.route),JSON.stringify(plan),blockedReason,at,at).run();

  const runId = randomId('run');
  await db.prepare(`INSERT INTO execution_runs (id,work_order_id,attempt,status,route_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(runId,work.id,1,'planned',JSON.stringify(plan.route),at,at).run();
  for (let i = 0; i < plan.route.length; i += 1) {
    const capabilityId = plan.route[i];
    const cap = capabilities.find((item) => item.id === capabilityId);
    await db.prepare(`INSERT INTO execution_steps (id,run_id,work_order_id,step_index,capability_id,title,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(randomId('step'),runId,work.id,i,capabilityId,cap?.name || capabilityId,'pending',at,at).run();
  }
  for (let i = 0; i < plan.acceptanceCriteria.length; i += 1) {
    await db.prepare(`INSERT INTO verification_results (id,work_order_id,criterion_index,criterion,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(randomId('verify'),work.id,i,plan.acceptanceCriteria[i],'pending',at,at).run();
  }
  await insertEvent(db, work.id, 'work_order_received', { sourceSystem: work.sourceSystem, plan });
  return { inserted: true, workOrder: await getWorkOrder(db, work.id) };
}

async function dashboard(db) {
  const [capabilities, ordersResult, eventsResult] = await Promise.all([
    readCapabilities(db),
    db.prepare('SELECT * FROM work_orders ORDER BY priority DESC,created_at DESC LIMIT 100').all(),
    db.prepare('SELECT * FROM factory_events ORDER BY created_at DESC LIMIT 30').all()
  ]);
  const workOrders = (ordersResult.results || []).map(rowToWorkOrder);
  const counts = { total: workOrders.length, queued: 0, running: 0, blocked: 0, verifying: 0, completed: 0, failed: 0 };
  for (const item of workOrders) if (item.status in counts) counts[item.status] += 1;
  return {
    version: '2.0.0',
    authority: 'Operating System owns prioritisation and approval; AI Factory executes approved work orders.',
    autonomy: { level: 2, name: 'isolated-execute', mayMerge: false, mayDeployProduction: false },
    counts,
    capabilities,
    workOrders,
    recentEvents: (eventsResult.results || []).map((row) => ({ ...row, detail: parseJson(row.detail_json, {}) }))
  };
}

async function updateCapability(db, id, input) {
  const existing = await db.prepare('SELECT * FROM factory_capabilities WHERE id=?').bind(id).first();
  if (!existing) return null;
  const allowedStatuses = new Set(['ready','limited','not_ready','approval_required','offline']);
  const status = allowedStatuses.has(input.status) ? input.status : existing.status;
  const readiness = Number.isFinite(Number(input.readiness)) ? Math.max(0, Math.min(100, Number(input.readiness))) : existing.readiness;
  const endpoint = input.endpoint === null ? null : safeString(input.endpoint, 1500) || existing.endpoint;
  const notes = safeString(input.notes, 3000) || existing.notes;
  await db.prepare('UPDATE factory_capabilities SET status=?,readiness=?,endpoint=?,notes=?,updated_at=? WHERE id=?')
    .bind(status,readiness,endpoint,notes,nowIso(),id).run();
  return db.prepare('SELECT * FROM factory_capabilities WHERE id=?').bind(id).first();
}

async function updateWorkOrderResult(db, body) {
  const id = safeString(body.workOrderId || body.id, 160);
  if (!id) throw new Error('workOrderId is required');
  const existing = await getWorkOrder(db, id);
  if (!existing) return null;
  const allowed = new Set(['queued','running','blocked','verifying','completed','failed','cancelled']);
  const status = allowed.has(body.status) ? body.status : existing.status;
  const at = nowIso();
  await db.prepare(`UPDATE work_orders SET status=?,summary=?,branch=?,pull_request_url=?,blocked_reason=?,updated_at=?,
    started_at=COALESCE(started_at,?),completed_at=? WHERE id=?`)
    .bind(status,safeString(body.summary,5000),safeString(body.branch,1000)||null,safeString(body.pullRequestUrl,1500)||null,
      safeString(body.error,3000)||null,at,['running','verifying','completed','failed'].includes(status)?at:null,['completed','failed','cancelled'].includes(status)?at:null,id).run();

  const run = await db.prepare('SELECT * FROM execution_runs WHERE work_order_id=? ORDER BY attempt DESC LIMIT 1').bind(id).first();
  if (run) {
    await db.prepare(`UPDATE execution_runs SET status=?,summary=?,branch=?,pull_request_url=?,cost=?,error=?,updated_at=?,
      started_at=COALESCE(started_at,?),completed_at=? WHERE id=?`)
      .bind(status,safeString(body.summary,5000),safeString(body.branch,1000)||null,safeString(body.pullRequestUrl,1500)||null,
        Number.isFinite(Number(body.cost))?Number(body.cost):null,safeString(body.error,3000)||null,at,
        ['running','verifying','completed','failed'].includes(status)?at:null,['completed','failed','cancelled'].includes(status)?at:null,run.id).run();
  }

  if (Array.isArray(body.verification)) {
    for (const item of body.verification.slice(0,100)) {
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0) continue;
      const vStatus = ['pending','passed','failed','waived'].includes(item.status) ? item.status : 'pending';
      await db.prepare(`UPDATE verification_results SET status=?,evidence_json=?,notes=?,updated_at=? WHERE work_order_id=? AND criterion_index=?`)
        .bind(vStatus,JSON.stringify(Array.isArray(item.evidence)?item.evidence:[]),safeString(item.notes,3000),at,id,index).run();
    }
  }
  await insertEvent(db,id,'execution_result',{status,summary:safeString(body.summary,1000),branch:body.branch||null,pullRequestUrl:body.pullRequestUrl||null});
  return getWorkOrder(db,id);
}

async function buildResultPacket(db, id) {
  const workOrder = await getWorkOrder(db,id);
  if (!workOrder) return null;
  const [verificationResult, run] = await Promise.all([
    db.prepare('SELECT criterion_index,criterion,status,evidence_json,notes FROM verification_results WHERE work_order_id=? ORDER BY criterion_index').bind(id).all(),
    db.prepare('SELECT * FROM execution_runs WHERE work_order_id=? ORDER BY attempt DESC LIMIT 1').bind(id).first()
  ]);
  return {
    workOrderId: id,
    status: workOrder.status,
    summary: workOrder.summary || '',
    branch: workOrder.branch || run?.branch || null,
    pullRequestUrl: workOrder.pull_request_url || run?.pull_request_url || null,
    artifacts: [],
    metrics: { cost: run?.cost ?? null, attempt: run?.attempt ?? 1 },
    evidence: (verificationResult.results || []).map((row) => ({
      criterion: row.criterion,
      status: row.status,
      evidence: parseJson(row.evidence_json,[]),
      notes: row.notes
    })),
    error: run?.error || workOrder.blocked_reason || null
  };
}

async function reportToOperatingSystem(db, env, id) {
  const packet = await buildResultPacket(db,id);
  if (!packet) return { ok:false,error:'Work order not found.' };
  if (!env.OS_URL || !env.FACTORY_RESULT_TOKEN) return { ok:false,configured:false,error:'OS_URL and FACTORY_RESULT_TOKEN are required for result reporting.' };
  const url = `${String(env.OS_URL).replace(/\/$/,'')}/api/integrations/factory/results`;
  try {
    const response = await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${env.FACTORY_RESULT_TOKEN}`},body:JSON.stringify(packet)});
    if (!response.ok) throw new Error(`Operating System returned ${response.status}`);
    await db.prepare('UPDATE work_orders SET result_reported_at=?,result_report_error=NULL,updated_at=? WHERE id=?').bind(nowIso(),nowIso(),id).run();
    await insertEvent(db,id,'result_reported',{url,status:packet.status});
    return { ok:true,configured:true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare('UPDATE work_orders SET result_report_error=?,updated_at=? WHERE id=?').bind(message,nowIso(),id).run();
    return { ok:false,configured:true,error:message };
  }
}

function json(payload,status=200){return Response.json(payload,{status,headers:{'cache-control':'no-store'}})}

export async function handleFactoryV2Api(request, env) {
  await ensureFactoryV2Schema(env.DB);
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/v2/health' && request.method === 'GET') {
    const caps = await readCapabilities(env.DB);
    return json({
      ok: true,
      service: 'ai-factory',
      version: '2.0.0',
      role: 'execution-engine',
      operatingSystemResultReportingConfigured: Boolean(env.OS_URL && env.FACTORY_RESULT_TOKEN),
      machineIngressConfigured: Boolean(env.FACTORY_WRITE_TOKEN),
      capabilities: caps.map((item)=>({id:item.id,status:item.status,readiness:item.readiness}))
    });
  }

  if (path === '/api/v2/dashboard' && request.method === 'GET') return json(await dashboard(env.DB));
  if (path === '/api/v2/capabilities' && request.method === 'GET') return json({capabilities:await readCapabilities(env.DB)});
  if (path === '/api/v2/work-orders' && request.method === 'GET') {
    const status = safeString(url.searchParams.get('status'),50);
    const result = status
      ? await env.DB.prepare('SELECT * FROM work_orders WHERE status=? ORDER BY priority DESC,created_at DESC LIMIT 200').bind(status).all()
      : await env.DB.prepare('SELECT * FROM work_orders ORDER BY priority DESC,created_at DESC LIMIT 200').all();
    return json({workOrders:(result.results||[]).map(rowToWorkOrder)});
  }
  if (path === '/api/v2/work-orders' && request.method === 'POST') {
    const body = await request.json();
    const result = await createWorkOrder(env.DB,body);
    return json({ok:true,...result},result.inserted?201:200);
  }

  const capabilityMatch = path.match(/^\/api\/v2\/capabilities\/([^/]+)$/);
  if (capabilityMatch && request.method === 'PATCH') {
    const updated = await updateCapability(env.DB,decodeURIComponent(capabilityMatch[1]),await request.json());
    return updated ? json({ok:true,capability:updated}) : json({error:'Capability not found.'},404);
  }

  const resultMatch = path.match(/^\/api\/v2\/work-orders\/([^/]+)\/result$/);
  if (resultMatch && request.method === 'POST') {
    const body = await request.json();
    body.workOrderId = decodeURIComponent(resultMatch[1]);
    const workOrder = await updateWorkOrderResult(env.DB,body);
    if (!workOrder) return json({error:'Work order not found.'},404);
    const report = ['completed','failed','cancelled'].includes(workOrder.status) ? await reportToOperatingSystem(env.DB,env,workOrder.id) : null;
    return json({ok:true,workOrder,report});
  }

  const reportMatch = path.match(/^\/api\/v2\/work-orders\/([^/]+)\/report$/);
  if (reportMatch && request.method === 'POST') return json(await reportToOperatingSystem(env.DB,env,decodeURIComponent(reportMatch[1])));

  const workMatch = path.match(/^\/api\/v2\/work-orders\/([^/]+)$/);
  if (workMatch && request.method === 'GET') {
    const id = decodeURIComponent(workMatch[1]);
    const workOrder = await getWorkOrder(env.DB,id);
    if (!workOrder) return json({error:'Work order not found.'},404);
    const [runResult,stepsResult,verifyResult,eventsResult] = await Promise.all([
      env.DB.prepare('SELECT * FROM execution_runs WHERE work_order_id=? ORDER BY attempt DESC').bind(id).all(),
      env.DB.prepare('SELECT * FROM execution_steps WHERE work_order_id=? ORDER BY step_index').bind(id).all(),
      env.DB.prepare('SELECT * FROM verification_results WHERE work_order_id=? ORDER BY criterion_index').bind(id).all(),
      env.DB.prepare('SELECT * FROM factory_events WHERE work_order_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all()
    ]);
    return json({workOrder,runs:runResult.results||[],steps:stepsResult.results||[],verification:(verifyResult.results||[]).map((row)=>({...row,evidence:parseJson(row.evidence_json,[])})),events:eventsResult.results||[]});
  }

  return json({error:'Factory V2 route not found.'},404);
}
