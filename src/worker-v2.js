import legacyWorker from './worker.js';
import { handleFactoryV2Api } from './factory-v2.mjs';

const encoder = new TextEncoder();

function json(payload,status=200){return Response.json(payload,{status,headers:{'cache-control':'no-store'}})}

async function safeEqual(provided, expected) {
  if (!provided || !expected) return false;
  const [a,b] = await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(provided)),
    crypto.subtle.digest('SHA-256',encoder.encode(expected))
  ]);
  return crypto.subtle.timingSafeEqual(a,b);
}

function bearerToken(request){
  const auth=request.headers.get('authorization')||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function authorizedV2(request,env){
  const machine=bearerToken(request)||request.headers.get('x-factory-token')||'';
  if(env.FACTORY_WRITE_TOKEN && await safeEqual(machine,env.FACTORY_WRITE_TOKEN)) return true;
  if(env.AI_FACTORY_KEY && await safeEqual(machine,env.AI_FACTORY_KEY)) return true;
  const human=request.headers.get('x-ai-factory-key')||'';
  if(env.AI_FACTORY_KEY && await safeEqual(human,env.AI_FACTORY_KEY)) return true;
  return false;
}

function rewriteToAsset(request,path){
  const url=new URL(request.url);
  url.pathname=path;
  return new Request(url.toString(),request);
}

function normalizeOperatingSystemEnvelope(payload){
  if(!payload?.job) return payload;
  const job=payload.job;
  return {
    id:job.id,
    sourceSystem:payload.source||'operating-system',
    sourceExternalId:job.id,
    projectId:job.projectId||null,
    projectName:job.projectName||null,
    repository:job.repository||null,
    objective:job.objective,
    priority:job.priority,
    constraints:[
      `Operating System risk level: ${job.riskLevel||'unknown'}`,
      'Keep implementation isolated unless the work order explicitly grants broader authority.'
    ],
    acceptanceCriteria:Array.isArray(job.acceptanceCriteria)?job.acceptanceCriteria:[],
    authority:job.authority||{
      mayCreateBranch:true,
      mayOpenPullRequest:true,
      mayMerge:false,
      mayDeployProduction:false,
      maySpend:false,
      mayExternalWrite:false
    },
    budget:job.budget||{},
    source:{system:payload.source||'operating-system',externalId:job.id}
  };
}

async function handleWorkOrderIngress(request,env){
  const payload=await request.json();
  const normalized=normalizeOperatingSystemEnvelope(payload);
  const forwarded=new Request(request.url,{
    method:'POST',
    headers:new Headers(request.headers),
    body:JSON.stringify(normalized)
  });
  const response=await handleFactoryV2Api(forwarded,env);
  let body;
  try{body=await response.clone().json()}catch{return response}
  if(body?.workOrder?.status==='blocked'){
    return json({
      ...body,
      status:'blocked',
      blockedReason:body.workOrder.blocked_reason||'Required Factory capability is not ready.'
    },409);
  }
  return json({...body,status:'accepted'},response.status);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname==='/factory-v2') return env.ASSETS.fetch(rewriteToAsset(request,'/factory-v2.html'));
      if(url.pathname.startsWith('/api/v2/')){
        if(url.pathname==='/api/v2/health') return handleFactoryV2Api(request,env);
        if(!(await authorizedV2(request,env))) return json({error:'Factory V2 access token required.'},401);
        if(url.pathname==='/api/v2/work-orders'&&request.method==='POST') return handleWorkOrderIngress(request,env);
        return handleFactoryV2Api(request,env);
      }
      return legacyWorker.fetch(request,env,ctx);
    }catch(error){
      console.error(JSON.stringify({event:'factory_v2_request_error',message:error?.message||String(error)}));
      return json({error:error?.message||'Internal server error.'},500);
    }
  }
};
