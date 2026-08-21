import legacy from './worker.js';

const encoder=new TextEncoder();
const json=(payload,status=200)=>Response.json(payload,{status,headers:{'cache-control':'no-store'}});

async function safeEqual(a,b){
  const [ha,hb]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(a||'')),
    crypto.subtle.digest('SHA-256',encoder.encode(b||''))
  ]);
  const aa=new Uint8Array(ha),bb=new Uint8Array(hb);let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
}

function bearer(request){const value=request.headers.get('authorization')||'';return value.startsWith('Bearer ')?value.slice(7):''}
async function authorized(request,env){
  if(!env.AI_FACTORY_KEY)return false;
  const supplied=bearer(request)||request.headers.get('x-ai-factory-key')||'';
  return supplied?safeEqual(supplied,env.AI_FACTORY_KEY):false;
}

async function ensureOsSchema(db){
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS os_jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      project_id TEXT,
      priority INTEGER NOT NULL DEFAULT 60,
      risk_level TEXT NOT NULL DEFAULT 'low',
      status TEXT NOT NULL DEFAULT 'queued',
      plan_json TEXT NOT NULL DEFAULT '[]',
      callback_url TEXT,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_os_jobs_status ON os_jobs(status,priority DESC,created_at ASC)`)
  ]);
}

async function readJson(request){
  if(!(request.headers.get('content-type')||'').includes('application/json'))throw new Error('JSON body required.');
  return request.json();
}

function normalizeJob(body){
  const job=body&&typeof body==='object'&&body.job&&typeof body.job==='object'?body.job:body;
  const id=String(job?.id||'').trim();
  const objective=String(job?.objective||'').trim().slice(0,10000);
  const title=String(job?.title||objective).trim().slice(0,300);
  if(!id||!objective)throw new Error('job.id and job.objective are required.');
  return {
    id,title:title||objective.slice(0,120),objective,
    projectId:job?.projectId?String(job.projectId).slice(0,300):null,
    priority:Math.max(1,Math.min(100,Number(job?.priority||60))),
    riskLevel:String(job?.riskLevel||'low').slice(0,30),
    plan:Array.isArray(job?.plan)?job.plan.slice(0,30):[],
    callbackUrl:job?.callbackUrl?String(job.callbackUrl).slice(0,1500):null
  };
}

async function callback(env,row,status,result={}){
  if(!row.callback_url||!env.OS_CALLBACK_TOKEN)return;
  try{
    await fetch(row.callback_url,{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${env.OS_CALLBACK_TOKEN}`},
      body:JSON.stringify({jobId:row.id,status,result})
    });
  }catch(error){console.error('OS callback failed',error)}
}

async function osApi(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/os/health'&&request.method==='GET'){
    await ensureOsSchema(env.DB);
    const counts=await env.DB.prepare(`SELECT status,COUNT(*) count FROM os_jobs GROUP BY status`).all();
    return json({ok:true,service:'ai-factory',osReceiver:true,writeProtected:Boolean(env.AI_FACTORY_KEY),queue:counts.results||[]});
  }
  if(!path.startsWith('/api/os/'))return null;
  if(!(await authorized(request,env)))return json({error:env.AI_FACTORY_KEY?'Write key required.':'AI_FACTORY_KEY is not configured.'},env.AI_FACTORY_KEY?401:503);
  await ensureOsSchema(env.DB);

  if(path==='/api/os/jobs'&&request.method==='POST'){
    const input=normalizeJob(await readJson(request));const now=new Date().toISOString();
    const existing=await env.DB.prepare('SELECT * FROM os_jobs WHERE id=?').bind(input.id).first();
    if(existing)return json({accepted:true,duplicate:true,status:existing.status,jobId:existing.id});
    await env.DB.prepare(`INSERT INTO os_jobs
      (id,title,objective,project_id,priority,risk_level,status,plan_json,callback_url,result_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'queued',?,?,'{}',?,?)`)
      .bind(input.id,input.title,input.objective,input.projectId,input.priority,input.riskLevel,JSON.stringify(input.plan),input.callbackUrl,now,now).run();
    return json({accepted:true,status:'queued',jobId:input.id,queue:'ai-factory'},202);
  }

  if(path==='/api/os/jobs'&&request.method==='GET'){
    const result=await env.DB.prepare(`SELECT * FROM os_jobs ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,priority DESC,created_at ASC LIMIT 100`).all();
    return json({jobs:(result.results||[]).map(row=>({...row,plan:JSON.parse(row.plan_json||'[]'),result:JSON.parse(row.result_json||'{}')}))});
  }

  const match=path.match(/^\/api\/os\/jobs\/([^/]+)$/);
  if(match&&request.method==='PATCH'){
    const id=decodeURIComponent(match[1]);const body=await readJson(request);
    const allowed=new Set(['queued','running','blocked','complete','cancelled']);
    const status=String(body.status||'');if(!allowed.has(status))return json({error:'Invalid status.'},400);
    const current=await env.DB.prepare('SELECT * FROM os_jobs WHERE id=?').bind(id).first();
    if(!current)return json({error:'Job not found.'},404);
    const result=body.result&&typeof body.result==='object'?body.result:{};
    const now=new Date().toISOString();const completed=status==='complete'?now:null;
    await env.DB.prepare('UPDATE os_jobs SET status=?,result_json=?,updated_at=?,completed_at=COALESCE(?,completed_at) WHERE id=?')
      .bind(status,JSON.stringify(result),now,completed,id).run();
    const row=await env.DB.prepare('SELECT * FROM os_jobs WHERE id=?').bind(id).first();
    if(status==='complete'||status==='blocked')await callback(env,row,status,result);
    return json({ok:true,jobId:id,status});
  }

  return json({error:'OS bridge route not found.'},404);
}

export default {
  async fetch(request,env,ctx){
    try{
      const handled=await osApi(request,env);
      if(handled)return handled;
      return legacy.fetch(request,env,ctx);
    }catch(error){
      console.error('AI Factory OS bridge',error);
      return json({error:error?.message||'Internal server error.'},500);
    }
  },
  async scheduled(controller,env,ctx){
    if(typeof legacy.scheduled==='function')return legacy.scheduled(controller,env,ctx);
  }
};
