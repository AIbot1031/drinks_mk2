import catalog from '../data/catalog.json';
import {groupProducts,favoriteProducts} from './products';
import { makeEngine } from './recommend';
import {conversationTurn} from './conversation';
import { validateInput } from './understand';
import type { Drink } from './types';
import { internalApi } from './internal';
import { accountApi, currentUser, storedPreferences } from './accounts';
import {validateSemanticReply} from './semantic-protocol';
import {applyLlmUnderstanding} from './llm-conversation';
export {SemanticBridge} from './semantic-bridge';

const drinks: Drink[] = catalog.drinks;
const engine = makeEngine(drinks);
const catalogVersion='ef2503d4ae5fe0324cd9d8e988719ca62800e5a24084971b8a0c2d00609ad97a';
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('請使用 application/json');
  if (!request.body) throw new Error('缺少查詢內容');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {await reader.cancel(); throw new Error('查詢內容過大');}
    body += decoder.decode(value, {stream: true});
  }
  body += decoder.decode();
  try { return JSON.parse(body); } catch { throw new Error('JSON 格式有誤'); }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if(['/api/semantic/connect','/api/training/events'].includes(url.pathname)){
        const supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
        if(!env.SEMANTIC_KEY||supplied.length>200)return json({error:'未授權'},401);
        const encoder=new TextEncoder();
        const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),crypto.subtle.digest('SHA-256',encoder.encode(env.SEMANTIC_KEY))]);
        if(!crypto.subtle.timingSafeEqual(a,b))return json({error:'未授權'},401);
        if(url.pathname==='/api/training/events'){
          if(request.method!=='GET')return json({error:'請求方法不支援'},405);
          const requested=Number(url.searchParams.get('cutoff_ms')??Date.now());
          if(!Number.isSafeInteger(requested)||requested<0)return json({error:'截止時間無效'},400);
          const cutoff=Math.min(requested,Date.now());
          const rows=await env.TRACE_DB.prepare("SELECT id,user_id,drink_id,action,occurred_at,request_id,catalog_version FROM consumer_interactions WHERE lower(substr(user_id,1,8))<>'testauth' AND occurred_at<=? ORDER BY occurred_at,id LIMIT 200001").bind(cutoff).all();
          if(rows.results.length>200000)return json({error:'資料超過單次匯出限制，需要分頁匯出'},413);
          return json({kind:'cloudflare-interaction-query',cutoff_ms:cutoff,catalogVersion,rows:rows.results});
        }
        return env.SEMANTIC_BRIDGE.getByName('inference-v2').fetch(request);
      }
      if(url.pathname==='/api/semantic/status'&&request.method==='GET')return json(await env.SEMANTIC_BRIDGE.getByName('inference-v2').status());
      if(url.pathname.startsWith('/api/account/'))return await accountApi(request,env,readBody,drinks);
      if(url.pathname.startsWith('/api/internal/'))return await internalApi(request,env,readBody);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ok: true, total: catalog.total, version: '2.3.0'});
      if (url.pathname === '/api/meta' && request.method === 'GET') return json({total: catalog.total, brands: catalog.brands, missing: catalog.missing, tea: [...new Set(drinks.flatMap(d=>d.tea))].sort(), toppings: [...new Set(drinks.flatMap(d=>d.toppings))].sort()});
      if (url.pathname === '/api/catalog/favorites' && request.method === 'POST') {
        const origin=request.headers.get('origin');
        if(origin && origin!==url.origin)return json({error:'請從本站送出查詢'},403);
        const body=await readBody(request) as {likedIds?:unknown}|null;
        if(!body || !Array.isArray(body.likedIds) || body.likedIds.length>200 || body.likedIds.some(id=>typeof id!=='string'||id.length>80))return json({error:'收藏查詢最多接受 200 個飲料 ID'},400);
        return json({results:favoriteProducts(drinks,body.likedIds)});
      }
      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        const query = (url.searchParams.get('q') ?? '').slice(0, 100).toLowerCase();
        const brand = url.searchParams.get('brand');
        const parsedPage = Number(url.searchParams.get('page') ?? 1);
        if (!Number.isInteger(parsedPage) || parsedPage < 1 || parsedPage > 1000) return json({error: '頁碼無效'}, 400);
        const pool = drinks.filter(d => (!brand || d.brand === brand) && `${d.name}${d.brand}${d.taste}`.toLowerCase().includes(query));
        const products=[...groupProducts(pool).values()].map(variants=>({...variants[0],variants}));
        return json({total: products.length, variantTotal:pool.length, page: parsedPage, pages: Math.ceil(products.length / 24), results: products.slice((parsedPage - 1) * 24, parsedPage * 24)});
      }
      if (['/api/recommend','/api/chat/recommend'].includes(url.pathname) && request.method === 'POST') {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return json({error: '請從本站送出查詢'}, 403);
        const body = await readBody(request);
        let conversation = url.pathname === '/api/chat/recommend' ? conversationTurn(body,Object.keys(catalog.brands)) : null;
        let llm:{modelVersion:string;durationMs:number;ack:string}|null=null;
        if(conversation&&!conversation.next&&!conversation.reset&&!conversation.state.guard){
          try{
            const result=await env.SEMANTIC_BRIDGE.getByName('inference-v2').conversation({message:conversation.message,state:conversation.state,
              brands:Object.keys(catalog.brands),tea:[...new Set(drinks.flatMap(d=>d.tea))],toppings:[...new Set(drinks.flatMap(d=>d.toppings))]});
            const parsed=applyLlmUnderstanding(conversation,result,Object.keys(catalog.brands),[...new Set(drinks.flatMap(d=>d.tea))],[...new Set(drinks.flatMap(d=>d.toppings))]);
            if(parsed){conversation={...conversation,state:parsed.state,input:parsed.input};llm={modelVersion:parsed.modelVersion,durationMs:parsed.durationMs,ack:parsed.ack};}
          }catch{/* Keep the validated rule turn; no relaxed constraints. */}
        }
        const input = conversation ? validateInput({...conversation.input, likedIds:(body as Record<string,unknown>).likedIds, dislikedIds:(body as Record<string,unknown>).dislikedIds, excludedIds:conversation.next ? (body as Record<string,unknown>).excludedIds : []}) : validateInput(body);
        const user=await currentUser(request,env.TRACE_DB);
        if(user){const prefs=storedPreferences(user.preferences);input.likedIds=prefs.likedIds;input.dislikedIds=prefs.dislikedIds;}
        const pool=engine.candidatePool(input);
        let semantic;
        if(pool.length){
          const job={query:input.query,candidateIds:pool.map(d=>d.id),catalogVersion,topK:100};
          try{
            const reply=validateSemanticReply(await env.SEMANTIC_BRIDGE.getByName('inference-v2').rank(job),job);
            semantic=reply?{...reply}:{scores:[],modelVersion:'',durationMs:0,fallbackReason:'Mac unavailable, timeout, or index mismatch'};
          }catch{semantic={scores:[],modelVersion:'',durationMs:0,fallbackReason:'Mac inference bridge error'};}
        }
        const {response,trace}=engine.recommendWithTrace(input,semantic);
        if(conversation)Object.assign(trace.understanding,{llmUsed:!!llm,parser:llm?'qwen3-8b-mac':'rules',llmModelVersion:llm?.modelVersion??null,llmDurationMs:llm?.durationMs??null});
        const traceId=crypto.randomUUID();
        const createdAt=new Date().toISOString();
        const record={traceId,createdAt,...trace,...(conversation ? {interface:'conversation',conversation:{message:conversation.message,state:conversation.state,next:conversation.next}} : {interface:'manual'})};
        try {
          await env.TRACE_DB.prepare('INSERT INTO recommendation_traces (id,created_at,query,result_count,payload) VALUES (?,?,?,?,?)').bind(traceId,createdAt,input.query,response.results.length,JSON.stringify(record)).run();
        } catch {
          console.error(JSON.stringify({event:'trace_save_failed',traceId}));
          return json({error:'推薦紀錄暫時無法儲存，請稍後重試'},503);
        }
        console.log(JSON.stringify({event:'recommendation_saved',traceId,resultCount:response.results.length}));
        return json({...response,traceId,...(conversation ? {state:conversation.state,next:conversation.next,chatMode:llm?'qwen3-8b':conversation.next||conversation.reset?'quick-command':'rules-fallback',chatModel:llm?.modelVersion??null,assistantMessage:response.blocked ? '這些條件目前無法確認，請查看說明。重新開始可以清除本輪條件。' : response.results.length ? `${llm?.ack??''} 找到 ${response.results.length} 杯符合條件的飲料。你可以繼續調整條件，或說「再推薦幾杯」。` : '目前沒有符合所有條件的飲料。你可以調整預算或條件，我不會自動放寬限制。'} : {})});
      }
      return json({error: '找不到此 API 或請求方法不支援'}, 404);
    } catch (error) {
      if (error instanceof Error && !error.message.includes('Internal')) return json({error: error.message}, 400);
      console.error(JSON.stringify({event: 'api_error', path: url.pathname}));
      return json({error: '服務暫時無法使用，請稍後再試'}, 500);
    }
  },
} satisfies ExportedHandler<Env>;
