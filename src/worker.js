import { buildWatchtower } from './watchtower.mjs';
import { buildReleaseFactory, buildToday } from './factory.mjs';
import {
  buildGhostWriterPacket,
  buildGitHubBridgePacket,
  buildKnowledgeBridgePacket,
  buildDecisionBridgePacket,
  buildProjectBrainBridgePacket,
  makeContentEligible,
  packetDedupeKey
} from './ghostwriter-bridge.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

const PROJECT_SEEDS = [
  { id:'ai-factory', name:'AI Factory', repo:'simplebusiness26/AI-Factory', purpose:'Central operating system for projects, agents, decisions, health and releases.', stage:'MVP', currentState:'Mission Control is live-in-build with Watchtower, Release Factory, Today, Decision Engine, Knowledge Mine and the Ghost Writer bridge unified.', nextActions:['Verify the live Cloudflare URL','Complete the go-live checklist','Start using Today and the Ghost Writer bridge as daily control surfaces'], blockers:[] },
  { id:'xplorer', name:'Xplorer', repo:'simplebusiness26/The-App', purpose:'Social discovery, planning and real-world activity app.', stage:'Active build', currentState:'Core product is under active feature, UX and design development.', nextActions:['Keep functionality and design work aligned with the actual app','Surface build/test health in Mission Control'], blockers:[] },
  { id:'livepark', name:'LivePark', repo:'simplebusiness26/LivePark', purpose:'Real-time parking marketplace with live availability and booking.', stage:'MVP', currentState:'MVP development and deployment hardening are active.', nextActions:['Surface APK/build health','Track infrastructure and database readiness'], blockers:[] },
  { id:'clipmine', name:'ClipMine', repo:'simplebusiness26/ClipMine', purpose:'Turn long videos or URLs into short-form social clips.', stage:'MVP', currentState:'Processing pipeline, hosting and product completion are the active focus.', nextActions:['Track backend deployment readiness','Track URL ingest and upload support'], blockers:[] },
  { id:'designlab', name:'DesignLab', repo:'simplebusiness26/DesignLab', purpose:'Code-aware UI/UX tournament that produces functional design variants.', stage:'Active build', currentState:'Design tournament architecture and cost-efficient model routing are being refined.', nextActions:['Keep design variants tied to real functionality','Reduce expensive model usage without reducing final quality'], blockers:[] },
  { id:'devcouncil', name:'DevCouncil', repo:'simplebusiness26/DevCouncil-', purpose:'Specialist engineering agents coordinated by a lead engineering agent.', stage:'Foundation', currentState:'Lead-agent and specialist-agent foundations are being developed.', nextActions:['Connect DevCouncil into AI Factory as the engineering department'], blockers:[] },
  { id:'ghost-writer', name:'The Ghost Writer', repo:'simplebusiness26/TheGhostWriter', purpose:'Agentic content system that turns source material and knowledge into platform-ready content.', stage:'Foundation', currentState:'Agent workflow is being built as a working internal system first.', nextActions:['Consume evidence packets from the AI Factory Ghost Writer bridge'], blockers:[] }
];

function json(payload,status=200){return Response.json(payload,{status,headers:{'cache-control':'no-store'}})}
function cleanString(value,max=5000){return typeof value==='string'?value.trim().slice(0,max):''}
function cleanList(value,maxItems=20,maxLength=500){if(!Array.isArray(value))return[];return value.map(v=>cleanString(v,maxLength)).filter(Boolean).slice(0,maxItems)}
function parseList(value){try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[]}catch{return[]}}
function daysSince(value){if(!value)return null;const time=new Date(value).getTime();if(!Number.isFinite(time))return null;return Math.max(0,Math.floor((Date.now()-time)/86400000))}
function activityStatus(snapshot){if(!snapshot||snapshot.error)return'unavailable';const age=daysSince(snapshot.pushedAt);if(age===null)return'unknown';if(age<=3)return'active';if(age<=14)return'warm';return'stale'}

async function ensureSchema(db){
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,repo TEXT NOT NULL,purpose TEXT NOT NULL,stage TEXT NOT NULL,current_state TEXT NOT NULL DEFAULT '',next_actions TEXT NOT NULL DEFAULT '[]',blockers TEXT NOT NULL DEFAULT '[]')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,date TEXT NOT NULL,title TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '')`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id,id DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS repo_cache (repo TEXT PRIMARY KEY,snapshot TEXT NOT NULL,cached_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS decision_cases (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,problem TEXT NOT NULL,options TEXT NOT NULL DEFAULT '[]',recommendation TEXT NOT NULL DEFAULT '',final_decision TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_decision_cases_created ON decision_cases(id DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_items (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,problem TEXT NOT NULL DEFAULT '',lesson TEXT NOT NULL,principle TEXT NOT NULL DEFAULT '',content_angle TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_items(id DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ghostwriter_bridge_events (id INTEGER PRIMARY KEY AUTOINCREMENT,dedupe_key TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL,source TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',truth_state TEXT NOT NULL,privacy TEXT NOT NULL,content_eligible INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'captured',packet TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ghostwriter_bridge_status ON ghostwriter_bridge_events(status,id DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ghostwriter_bridge_project ON ghostwriter_bridge_events(project_id,id DESC)`)
  ]);
  await db.batch(PROJECT_SEEDS.map(p=>db.prepare(`INSERT OR IGNORE INTO projects (id,name,repo,purpose,stage,current_state,next_actions,blockers) VALUES (?,?,?,?,?,?,?,?)`).bind(p.id,p.name,p.repo,p.purpose,p.stage,p.currentState,JSON.stringify(p.nextActions),JSON.stringify(p.blockers))));
  await db.prepare(`INSERT OR IGNORE INTO decisions (id,project_id,date,title,decision,reason) VALUES (1,'ai-factory','2026-08-17','Start with the central nervous system','Build Mission Control + Project Brain before the rest of the factory systems.','The other systems need one shared source of truth and control surface.')`).run();
}

async function readProjects(db){
  const [projectResult,decisionResult]=await db.batch([db.prepare('SELECT * FROM projects ORDER BY rowid'),db.prepare('SELECT project_id,date,title,decision,reason FROM decisions ORDER BY id DESC')]);
  const grouped=new Map();
  for(const item of decisionResult.results||[]){if(!grouped.has(item.project_id))grouped.set(item.project_id,[]);grouped.get(item.project_id).push({date:item.date,title:item.title,decision:item.decision,reason:item.reason})}
  return (projectResult.results||[]).map(row=>({id:row.id,name:row.name,repo:row.repo,purpose:row.purpose,stage:row.stage,brain:{currentState:row.current_state,nextActions:parseList(row.next_actions),blockers:parseList(row.blockers),decisions:grouped.get(row.id)||[]}}));
}

async function githubRequest(path,env){
  const headers={accept:'application/vnd.github+json','user-agent':'AI-Factory-Mission-Control','x-github-api-version':'2022-11-28'};
  if(env.GITHUB_TOKEN)headers.authorization=`Bearer ${env.GITHUB_TOKEN}`;
  const response=await fetch(`https://api.github.com${path}`,{headers});
  if(!response.ok){let message=`GitHub returned ${response.status}`;try{const body=await response.json();if(body.message)message=body.message}catch{}const error=new Error(message);error.status=response.status;throw error}
  return response.json();
}

async function latestRelease(owner,name,env){
  try{
    const release=await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/latest`,env);
    return {name:release.name||release.tag_name||null,tag:release.tag_name||null,url:release.html_url||null,publishedAt:release.published_at||null,assets:(release.assets||[]).slice(0,30).map(asset=>({name:asset.name,url:asset.browser_download_url||null,size:asset.size||null}))};
  }catch(error){if(error.status===404)return null;return null}
}

async function liveRepoSnapshot(repo,env){
  const [owner,name]=repo.split('/');
  if(!owner||!name)return{repo,error:'Invalid repository name.',activity:'unavailable'};
  try{
    const meta=await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,env);
    let latestCommit=null;
    try{const commits=await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=1`,env);const commit=commits?.[0];if(commit)latestCommit={sha:commit.sha,shortSha:String(commit.sha||'').slice(0,7),message:String(commit.commit?.message||'').split('\n')[0].slice(0,160),date:commit.commit?.committer?.date||commit.commit?.author?.date||null,author:commit.commit?.author?.name||commit.author?.login||'Unknown',url:commit.html_url||null}}catch{}
    let build={status:'not-checked',conclusion:null,name:null,url:null};
    try{const runs=await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs?per_page=1`,env);const run=runs.workflow_runs?.[0];build=run?{status:run.status||'unknown',conclusion:run.conclusion||null,name:run.name||null,url:run.html_url||null}:{status:'no-runs',conclusion:null,name:null,url:null}}catch{build={status:env.GITHUB_TOKEN?'unavailable':'not-checked',conclusion:null,name:null,url:null}}
    const release=await latestRelease(owner,name,env);
    const snapshot={repo,fullName:meta.full_name,url:meta.html_url,visibility:meta.visibility||(meta.private?'private':'public'),defaultBranch:meta.default_branch,pushedAt:meta.pushed_at,updatedAt:meta.updated_at,openItems:meta.open_issues_count||0,archived:Boolean(meta.archived),latestCommit,build,latestRelease:release,authenticated:Boolean(env.GITHUB_TOKEN)};
    snapshot.activity=activityStatus(snapshot);return snapshot;
  }catch(error){return{repo,error:error.status===404&&!env.GITHUB_TOKEN?'Repository is private or unavailable. Add GITHUB_TOKEN to read private repositories.':error.message,status:error.status||null,activity:'unavailable',authenticated:Boolean(env.GITHUB_TOKEN)}}
}

async function enrichProjects(projects,db,env,force=false){
  const cacheResult=await db.prepare('SELECT repo,snapshot,cached_at FROM repo_cache').all();const cache=new Map((cacheResult.results||[]).map(row=>[row.repo,row]));const now=Date.now();const fresh=[];
  const enriched=await Promise.all(projects.map(async project=>{const cached=cache.get(project.repo);if(!force&&cached&&now-Number(cached.cached_at)<CACHE_TTL_MS){try{return{...project,github:JSON.parse(cached.snapshot)}}catch{}}const github=await liveRepoSnapshot(project.repo,env);fresh.push({repo:project.repo,github});return{...project,github}}));
  if(fresh.length)await db.batch(fresh.map(({repo,github})=>db.prepare(`INSERT INTO repo_cache (repo,snapshot,cached_at) VALUES (?,?,?) ON CONFLICT(repo) DO UPDATE SET snapshot=excluded.snapshot,cached_at=excluded.cached_at`).bind(repo,JSON.stringify(github),now)));
  return enriched;
}

function makeSummary(projects,env){return{total:projects.length,active:projects.filter(p=>['active','warm'].includes(p.github?.activity)).length,attention:projects.filter(p=>['stale','unavailable'].includes(p.github?.activity)||(p.brain?.blockers||[]).length>0).length,blockers:projects.reduce((sum,p)=>sum+(p.brain?.blockers||[]).length,0),buildsFailing:projects.filter(p=>p.github?.build?.conclusion==='failure').length,lastSynced:new Date().toISOString(),githubAuthenticated:Boolean(env.GITHUB_TOKEN)}}

async function enqueueGhostWriterPacket(db,packet,status){
  if(!packet)return{inserted:false,id:null};
  const now=new Date().toISOString();
  const dedupeKey=packetDedupeKey(packet);
  const initialStatus=status||(packet.contentEligible?'queued':'captured');
  const result=await db.prepare(`INSERT OR IGNORE INTO ghostwriter_bridge_events (dedupe_key,project_id,source,title,truth_state,privacy,content_eligible,status,packet,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
    dedupeKey,packet.projectId,packet.source,packet.title||'',packet.truthState,packet.privacy,packet.contentEligible?1:0,initialStatus,JSON.stringify(packet),now,now
  ).run();
  return{inserted:Boolean(result.meta?.changes),id:result.meta?.last_row_id||null,dedupeKey};
}

async function captureProjectBridgeSnapshots(db,projects){
  const packets=projects.map(buildGitHubBridgePacket).filter(Boolean);
  if(!packets.length)return;
  for(const packet of packets)await enqueueGhostWriterPacket(db,packet,'captured');
}

function bridgeRow(row){
  let packet={};try{packet=JSON.parse(row.packet||'{}')}catch{}
  return{id:row.id,projectId:row.project_id,source:row.source,title:row.title,truthState:row.truth_state,privacy:row.privacy,contentEligible:Boolean(row.content_eligible),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,packet};
}

async function readBridge(db,status){
  const allowed=new Set(['captured','queued','consumed','dismissed']);
  const chosen=allowed.has(status)?status:null;
  const result=chosen
    ? await db.prepare('SELECT * FROM ghostwriter_bridge_events WHERE status=? ORDER BY id DESC LIMIT 200').bind(chosen).all()
    : await db.prepare('SELECT * FROM ghostwriter_bridge_events ORDER BY id DESC LIMIT 200').all();
  const events=(result.results||[]).map(bridgeRow);
  const counts=await db.prepare(`SELECT status,COUNT(*) AS count FROM ghostwriter_bridge_events GROUP BY status`).all();
  const summary={captured:0,queued:0,consumed:0,dismissed:0,total:0};
  for(const item of counts.results||[]){if(item.status in summary)summary[item.status]=Number(item.count)||0;summary.total+=Number(item.count)||0}
  return{summary,events};
}

async function snapshotAll(db,env,force=false){const projects=await readProjects(db);const enriched=await enrichProjects(projects,db,env,force);await captureProjectBridgeSnapshots(db,enriched);const watchtower=buildWatchtower(enriched);return{projects:enriched,summary:makeSummary(enriched,env),watchtower,releases:buildReleaseFactory(enriched),today:buildToday(enriched,watchtower)}}

async function safeEqual(provided,expected){const[a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(provided||'')),crypto.subtle.digest('SHA-256',encoder.encode(expected||''))]);return crypto.subtle.timingSafeEqual(a,b)}
async function requireWriteAccess(request,env){if(!env.AI_FACTORY_KEY)return json({error:'Writes are locked until AI_FACTORY_KEY is configured in Cloudflare.'},503);const provided=request.headers.get('x-ai-factory-key')||'';if(!(await safeEqual(provided,env.AI_FACTORY_KEY)))return json({error:'Write key required.'},401);return null}
async function readJson(request){const type=request.headers.get('content-type')||'';if(!type.includes('application/json'))throw new Error('JSON body required.');return request.json()}

async function readDecisionCases(db){const result=await db.prepare('SELECT * FROM decision_cases ORDER BY id DESC LIMIT 100').all();return(result.results||[]).map(row=>({...row,options:parseList(row.options)}))}
async function readKnowledge(db){const result=await db.prepare('SELECT * FROM knowledge_items ORDER BY id DESC LIMIT 200').all();return result.results||[]}

async function handleApi(request,env){
  await ensureSchema(env.DB);const url=new URL(request.url);const path=url.pathname;
  if(path==='/api/health'&&request.method==='GET')return json({ok:true,service:'ai-factory',version:'0.4.0-ghostwriter-bridge',runtime:'cloudflare-workers',database:'d1',githubAuthenticated:Boolean(env.GITHUB_TOKEN),writeProtected:Boolean(env.AI_FACTORY_KEY),systems:['mission-control','watchtower','release-factory','today','decision-engine','knowledge-mine','ghost-writer-bridge']});
  if(path==='/api/factory'&&request.method==='GET')return json(await snapshotAll(env.DB,env,url.searchParams.get('refresh')==='1'));
  if(path==='/api/projects'&&request.method==='GET'){const snap=await snapshotAll(env.DB,env,url.searchParams.get('refresh')==='1');return json({summary:snap.summary,projects:snap.projects,watchtower:snap.watchtower,releases:snap.releases,today:snap.today})}

  if(path==='/api/ghostwriter-bridge'&&request.method==='GET'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;
    return json(await readBridge(env.DB,url.searchParams.get('status')));
  }
  if(path==='/api/ghostwriter-bridge/queue'&&request.method==='GET'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;
    const bridge=await readBridge(env.DB,'queued');
    return json({count:bridge.events.length,packets:bridge.events.map(item=>({bridgeId:item.id,...item.packet}))});
  }
  if(path==='/api/ghostwriter-bridge'&&request.method==='POST'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;const body=await readJson(request);
    const packet=buildGhostWriterPacket({projectId:cleanString(body.projectId,100)||'ai-factory',source:cleanString(body.source,120)||'ai-factory:manual',sessionId:cleanString(body.sessionId,500),title:cleanString(body.title,500),text:cleanString(body.text,12000),evidence:Array.isArray(body.evidence)?body.evidence:[],sourceReference:cleanString(body.sourceReference,1500),occurredAt:cleanString(body.occurredAt,100),truthState:cleanString(body.truthState,30),privacy:cleanString(body.privacy,30)||'internal',contentEligible:body.contentEligible===true});
    const queued=await enqueueGhostWriterPacket(env.DB,packet,packet.contentEligible?'queued':'captured');return json({ok:true,...queued,packet},queued.inserted?201:200)
  }
  const bridgeAction=path.match(/^\/api\/ghostwriter-bridge\/(\d+)\/(queue|consume|dismiss)$/);
  if(bridgeAction&&request.method==='POST'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;const id=Number(bridgeAction[1]);const action=bridgeAction[2];const existing=await env.DB.prepare('SELECT * FROM ghostwriter_bridge_events WHERE id=?').bind(id).first();if(!existing)return json({error:'Bridge event not found.'},404);
    let packet={};try{packet=JSON.parse(existing.packet||'{}')}catch{return json({error:'Bridge packet is corrupt.'},500)}
    const now=new Date().toISOString();
    if(action==='queue'){
      packet=makeContentEligible(packet);
      await env.DB.prepare(`UPDATE ghostwriter_bridge_events SET privacy='content_eligible',content_eligible=1,status='queued',packet=?,updated_at=? WHERE id=?`).bind(JSON.stringify(packet),now,id).run();
      return json({ok:true,id,status:'queued',packet});
    }
    const nextStatus=action==='consume'?'consumed':'dismissed';
    await env.DB.prepare('UPDATE ghostwriter_bridge_events SET status=?,updated_at=? WHERE id=?').bind(nextStatus,now,id).run();return json({ok:true,id,status:nextStatus})
  }

  if(path==='/api/decisions'&&request.method==='GET')return json({cases:await readDecisionCases(env.DB)});
  if(path==='/api/decisions'&&request.method==='POST'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;const body=await readJson(request);const title=cleanString(body.title,200);const problem=cleanString(body.problem,3000);if(!title||!problem)return json({error:'Title and problem are required.'},400);const options=cleanList(body.options,10,1000);const status=cleanString(body.finalDecision,3000)?'decided':'open';
    const record={projectId:cleanString(body.projectId,100),title,problem,options,recommendation:cleanString(body.recommendation,3000),finalDecision:cleanString(body.finalDecision,3000),reason:cleanString(body.reason,3000),status,createdAt:new Date().toISOString()};
    const result=await env.DB.prepare(`INSERT INTO decision_cases (project_id,title,problem,options,recommendation,final_decision,reason,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(record.projectId,record.title,record.problem,JSON.stringify(record.options),record.recommendation,record.finalDecision,record.reason,record.status,record.createdAt).run();
    record.id=result.meta?.last_row_id||null;await enqueueGhostWriterPacket(env.DB,buildDecisionBridgePacket(record),'captured');return json({ok:true,id:record.id,case:record},201)
  }
  if(path==='/api/knowledge'&&request.method==='GET')return json({items:await readKnowledge(env.DB)});
  if(path==='/api/knowledge'&&request.method==='POST'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;const body=await readJson(request);const title=cleanString(body.title,200);const lesson=cleanString(body.lesson,4000);if(!title||!lesson)return json({error:'Title and lesson are required.'},400);const record={projectId:cleanString(body.projectId,100),title,problem:cleanString(body.problem,3000),lesson,principle:cleanString(body.principle,3000),contentAngle:cleanString(body.contentAngle,3000),createdAt:new Date().toISOString()};const result=await env.DB.prepare(`INSERT INTO knowledge_items (project_id,title,problem,lesson,principle,content_angle,created_at) VALUES (?,?,?,?,?,?,?)`).bind(record.projectId,record.title,record.problem,record.lesson,record.principle,record.contentAngle,record.createdAt).run();record.id=result.meta?.last_row_id||null;const packet=buildKnowledgeBridgePacket(record);await enqueueGhostWriterPacket(env.DB,packet,packet.contentEligible?'queued':'captured');return json({ok:true,id:record.id,item:record,ghostWriterQueued:packet.contentEligible},201)
  }
  const projectMatch=path.match(/^\/api\/projects\/([^/]+)$/);if(projectMatch&&request.method==='GET'){const snap=await snapshotAll(env.DB,env,url.searchParams.get('refresh')==='1');const project=snap.projects.find(item=>item.id===decodeURIComponent(projectMatch[1]));if(!project)return json({error:'Project not found.'},404);return json(project)}
  const brainMatch=path.match(/^\/api\/projects\/([^/]+)\/brain$/);if(brainMatch&&request.method==='PUT'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;const id=decodeURIComponent(brainMatch[1]);const body=await readJson(request);const existing=await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();if(!existing)return json({error:'Project not found.'},404);const brain={currentState:cleanString(body.currentState,5000),nextActions:cleanList(body.nextActions),blockers:cleanList(body.blockers)};await env.DB.prepare(`UPDATE projects SET current_state=?,next_actions=?,blockers=? WHERE id=?`).bind(brain.currentState,JSON.stringify(brain.nextActions),JSON.stringify(brain.blockers),id).run();await enqueueGhostWriterPacket(env.DB,buildProjectBrainBridgePacket({id,name:existing.name},brain),'captured');return json({ok:true})
  }
  const decisionMatch=path.match(/^\/api\/projects\/([^/]+)\/decisions$/);if(decisionMatch&&request.method==='POST'){
    const denied=await requireWriteAccess(request,env);if(denied)return denied;const id=decodeURIComponent(decisionMatch[1]);const body=await readJson(request);const decision=cleanString(body.decision,2000);if(!decision)return json({error:'Decision is required.'},400);const existing=await env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(id).first();if(!existing)return json({error:'Project not found.'},404);const record={date:new Date().toISOString().slice(0,10),title:cleanString(body.title,200)||'Decision',decision,reason:cleanString(body.reason,2000)};const result=await env.DB.prepare(`INSERT INTO decisions (project_id,date,title,decision,reason) VALUES (?,?,?,?,?)`).bind(id,record.date,record.title,record.decision,record.reason).run();await enqueueGhostWriterPacket(env.DB,buildDecisionBridgePacket({id:result.meta?.last_row_id,projectId:id,title:record.title,problem:`Project decision for ${existing.name}`,finalDecision:record.decision,reason:record.reason,createdAt:new Date().toISOString()}),'captured');return json({ok:true,decision:record},201)
  }
  return json({error:'API route not found.'},404);
}

export default{async fetch(request,env){try{const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return await handleApi(request,env);return await env.ASSETS.fetch(request)}catch(error){console.error(JSON.stringify({event:'request_error',message:error?.message||String(error)}));return json({error:error?.message||'Internal server error.'},500)}}};
