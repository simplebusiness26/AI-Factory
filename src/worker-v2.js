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
  const human=request.headers.get('x-ai-factory-key')||'';
  if(env.AI_FACTORY_KEY && await safeEqual(human,env.AI_FACTORY_KEY)) return true;
  return false;
}

function rewriteToAsset(request,path){
  const url=new URL(request.url);
  url.pathname=path;
  return new Request(url.toString(),request);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname==='/factory-v2') return env.ASSETS.fetch(rewriteToAsset(request,'/factory-v2.html'));
      if(url.pathname.startsWith('/api/v2/')){
        if(url.pathname==='/api/v2/health') return handleFactoryV2Api(request,env);
        if(!(await authorizedV2(request,env))) return json({error:'Factory V2 access token required.'},401);
        return handleFactoryV2Api(request,env);
      }
      return legacyWorker.fetch(request,env,ctx);
    }catch(error){
      console.error(JSON.stringify({event:'factory_v2_request_error',message:error?.message||String(error)}));
      return json({error:error?.message||'Internal server error.'},500);
    }
  }
};
