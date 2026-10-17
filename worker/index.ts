import {nearbyChoices} from './alternatives';
import {refreshTrends,publicTrends} from './trends';
import {prepareManualUnderstanding,applyManualUnderstanding} from './manual-understanding';
import {validateTrainingSummary} from './training-summary';
import {appVersion} from './app-version';
import {catalogFeatures,featureSchemaVersion,preferenceProfile,chatHistory} from './catalog-features';
import catalog from '../data/catalog.json';
import {groupProducts,favoriteProducts,createProductPreferences} from './products';
import { makeEngine } from './recommend';
import {conversationTurn} from './conversation';
import { validateInput,understand } from './understand';
import type { Drink } from './types';
import { internalApi } from './internal';
import { accountApi, currentUser, storedPreferences } from './accounts';
import {validateSemanticReply} from './semantic-protocol';
import {applyLlmUnderstanding} from './llm-conversation';
import {anonymousRelgtUser,validateRelgtReply} from './relgt-protocol';
import type {RelgtHistory,RelgtReply} from './relgt-protocol';
import {catalogVersion,compatibleCatalogVersions} from './catalog-version';
import {milkTeaRetrievalQuery} from './drink-language';
import {flavorQuery} from './numeric-language';
import {consumerContractMatches} from './consumer-contract';
import {wellbeingAdvice} from './wellbeing';
export {SemanticBridge} from './semantic-bridge';

const drinks: Drink[] = catalog.drinks;
const engine = makeEngine(drinks);
const productPreferences=createProductPreferences(drinks);
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
      if(url.pathname==='/api/trends'&&request.method==='GET')return json(await publicTrends(env.TRACE_DB));
      if(['/api/trends/refresh','/api/semantic/connect','/api/training/events','/api/training/reports'].includes(url.pathname)){
        const supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
        const role=url.searchParams.get('role')??'mac';
        if(url.pathname==='/api/semantic/connect'&&!['mac','llm','relgt'].includes(role))return json({error:'未知模型角色'},400);
        const expected=url.pathname==='/api/semantic/connect'?(role==='llm'?env.LLM_KEY:role==='relgt'?env.RELGT_KEY:env.SEMANTIC_KEY):env.SEMANTIC_KEY;
        if(!expected||supplied.length>200)return json({error:'未授權'},401);
        const encoder=new TextEncoder();
        const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
        if(!crypto.subtle.timingSafeEqual(a,b))return json({error:'未授權'},401);
        if(url.pathname==='/api/trends/refresh'){
          if(request.method!=='POST')return json({error:'請求方法不支援'},405);
          return json(await refreshTrends(env.TRACE_DB,drinks,catalogVersion));
        }
        if(url.pathname==='/api/training/reports'){
          if(request.method!=='POST')return json({error:'請求方法不支援'},405);
          const report=validateTrainingSummary(await readBody(request));
          await env.TRACE_DB.prepare('INSERT INTO training_summaries (run_id,model,started_at,payload,synced_at) VALUES (?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at').bind(report.runId,report.model,report.startedAt,JSON.stringify(report),new Date().toISOString()).run();
          return json({ok:true,runId:report.runId});
        }
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
      if(url.pathname.startsWith('/api/account/'))return await accountApi(request,env,readBody,drinks,productPreferences);
      if(url.pathname.startsWith('/api/internal/'))return await internalApi(request,env,readBody);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ok: true, total: catalog.total, version: appVersion});
      if (url.pathname === '/api/meta' && request.method === 'GET') return json({total: catalog.total, brands: catalog.brands, missing: catalog.missing, tea: [...new Set(drinks.flatMap(d=>d.tea))].sort(), toppings: [...new Set(drinks.flatMap(d=>d.toppings))].sort()});
      if (url.pathname === '/api/catalog/favorites' && request.method === 'POST') {
        const origin=request.headers.get('origin');
        if(origin && origin!==url.origin)return json({error:'請從本站送出查詢'},403);
        const body=await readBody(request) as {likedIds?:unknown}|null;
        if(!body || !Array.isArray(body.likedIds) || body.likedIds.length>200 || body.likedIds.some(id=>typeof id!=='string'||id.length>80))return json({error:'收藏查詢最多接受 200 個飲料 ID'},400);
        return json({results:favoriteProducts(drinks,body.likedIds)});
      }
      if(url.pathname==='/api/catalog/preferences'&&request.method==='POST'){
        const origin=request.headers.get('origin');
        if(origin&&origin!==url.origin)return json({error:'請從本站送出查詢'},403);
        const body=await readBody(request);
        if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('請提供偏好 JSON 物件');
        const prefs=validateInput({...body,query:''});
        return json(productPreferences.feedback(prefs));
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
        const manualOriginal=conversation?null:validateInput(body);
        const manual=manualOriginal?.query?prepareManualUnderstanding(manualOriginal,Object.keys(catalog.brands)):null;
        const understandingTurn=conversation??manual?.turn;
        let manualParsed:ReturnType<typeof applyManualUnderstanding>=null;
        let manualModelAttempted=false;
        const user=await currentUser(request,env.TRACE_DB);
        const userPrefs=productPreferences.normalize(user?storedPreferences(user.preferences):validateInput({query:'',likedIds:(body as Record<string,unknown>).likedIds,dislikedIds:(body as Record<string,unknown>).dislikedIds}));
        const history=conversation?chatHistory((body as Record<string,unknown>).history):[];
        let llm:{modelVersion:string;durationMs:number;ack:string;clarify:boolean}|null=null;
        if(understandingTurn&&(manual||(!understandingTurn.reset&&!understandingTurn.next&&!understandingTurn.followUp&&!understandingTurn.constraintOnly))&&!(/過敏|花生|堅果|乳糖不耐|麩質/.test(understandingTurn.state.guard)||(/忌口/.test(understandingTurn.state.guard)&&!understandingTurn.state.guard.startsWith('忌口：')))){
          manualModelAttempted=!!manual;
          try{
            const result=await env.SEMANTIC_BRIDGE.getByName('inference-v2').conversation({message:understandingTurn.message,state:understandingTurn.state,
              history,preferenceProfile:preferenceProfile(drinks,userPrefs.likedIds,userPrefs.dislikedIds),catalogFeatures:catalogFeatures(drinks),brands:Object.keys(catalog.brands),tea:[...new Set(drinks.flatMap(d=>d.tea))],toppings:[...new Set(drinks.flatMap(d=>d.toppings))]});
            const parsed=manual?applyManualUnderstanding(manual,result,Object.keys(catalog.brands),[...new Set(drinks.flatMap(d=>d.tea))],[...new Set(drinks.flatMap(d=>d.toppings))]):applyLlmUnderstanding(conversation!,result,Object.keys(catalog.brands),[...new Set(drinks.flatMap(d=>d.tea))],[...new Set(drinks.flatMap(d=>d.toppings))]);
            if(parsed){if(manual)manualParsed=parsed;else conversation={...conversation!,state:parsed.state,input:parsed.input};llm={modelVersion:parsed.modelVersion,durationMs:parsed.durationMs,ack:parsed.ack,clarify:parsed.clarify};}
          }catch{/* Keep the validated rule turn; no relaxed constraints. */}
        }
        const input = conversation ? validateInput({...conversation.input, likedIds:(body as Record<string,unknown>).likedIds, dislikedIds:(body as Record<string,unknown>).dislikedIds, excludedIds:conversation.next ? (body as Record<string,unknown>).excludedIds : []}) :manualParsed?.input??manual?.turn.input??manualOriginal!;
        const submittedInput=manualOriginal?{query:manualOriginal.query,filters:structuredClone(manualOriginal.filters)}:null;
        const parsedQuery=understand(input,Object.keys(catalog.brands));
        input.filters=parsedQuery.filters;
        input.query=milkTeaRetrievalQuery(input.query,input.filters.milkTea===false);
        if(conversation&&!parsedQuery.blocked)input.query=flavorQuery(input.query);
        Object.assign(input,userPrefs);
        const manualFollowUp=manual?.turn.followUp;
        const needsClarification=!!conversation?.followUp||!!manualFollowUp||!!llm?.clarify;
        if(needsClarification)input.query='等待對話釐清：';
        const pool=engine.candidatePool(input);
        let semantic;
        if(pool.length){
          const job={query:input.query,candidateIds:pool.map(d=>d.id),catalogVersion,topK:100};
          try{
            const reply=validateSemanticReply(await env.SEMANTIC_BRIDGE.getByName('inference-v2').rank(job),job);
            semantic=reply?{...reply}:{scores:[],modelVersion:'',durationMs:0,fallbackReason:'Mac unavailable, timeout, or index mismatch'};
          }catch{semantic={scores:[],modelVersion:'',durationMs:0,fallbackReason:'Mac inference bridge error'};}
        }
        let relgt:RelgtReply={scores:[],modelVersion:'',catalogVersion,durationMs:0,historyCount:0,fallbackReason:user?'no_history':'guest'};
        if(user&&pool.length&&!needsClarification){
          try{
            const at=Date.now();
            const versions=[catalogVersion,...compatibleCatalogVersions,'2.1.0'];
            const rows=await env.TRACE_DB.prepare(`SELECT drink_id,action,occurred_at FROM consumer_interactions WHERE user_id=? AND occurred_at<? AND catalog_version IN (${versions.map(()=>'?').join(',')}) ORDER BY occurred_at DESC,id DESC LIMIT 8`).bind(user.id,at,...versions).all<{drink_id:string;action:RelgtHistory['action'];occurred_at:number}>();
            const known=new Set(drinks.map(d=>d.id));
            const history:RelgtHistory[]=rows.results.filter(e=>known.has(e.drink_id)).reverse().map(e=>({drinkId:e.drink_id,action:e.action,occurredAt:e.occurred_at}));
            if(history.length){
              const job={userCode:await anonymousRelgtUser(user.id,env.RELGT_USER_KEY),at,history,candidateIds:pool.map(d=>d.id),catalogVersion,topK:100};
              const reply=validateRelgtReply(await env.SEMANTIC_BRIDGE.getByName('inference-v2').relgtRank(job),job);
              relgt=reply??{...relgt,fallbackReason:'RelGT unavailable, timeout, or invalid reply'};
            }
          }catch{relgt={...relgt,fallbackReason:'RelGT history or inference unavailable'};}
        }
        const {response,trace}=engine.recommendWithTrace(input,semantic,relgt);
        if(conversation){
          response.wellbeing=wellbeingAdvice(conversation.message);
          response.warnings=[...new Set([...response.warnings,...response.wellbeing.notes])];
        }
        if(needsClarification){response.results=[];response.blocked=false;response.warnings=[];}
        if(!consumerContractMatches(input.filters,response.filters,response.results)){console.error(JSON.stringify({event:'recommendation_contract_failed'}));return json({error:'這次結果與篩選條件不一致，已停止顯示，請重試。'},503);}
        const nearby=nearbyChoices(engine,drinks,input,response,needsClarification);
        Object.assign(response,nearby);
        if(conversation){conversation.state.filters=response.filters;if(!needsClarification&&!response.blocked)conversation.state.query=response.query;}
        if(conversation){response.warnings=[...new Set([...response.warnings,...conversation.warnings])];}
        if(manual){response.warnings=[...new Set([...response.warnings,...manual.rules.warnings,...manual.turn.warnings,...(manualFollowUp?[manualFollowUp.message]:[])])];}
        if(conversation)Object.assign(trace.understanding,{llmUsed:!!llm,parser:llm?'qwen-mac':'rules',llmModelVersion:llm?.modelVersion??null,llmDurationMs:llm?.durationMs??null,llmAction:needsClarification?'clarify':'recommend',llmFeatureSchema:llm?featureSchemaVersion:null,llmCatalogVersion:llm?catalogVersion:null,consumerWarnings:response.warnings});
        if(manual)Object.assign(trace.understanding,{llmUsed:!!llm,parser:llm?'qwen-mac':'rules',llmModelVersion:llm?.modelVersion??null,llmDurationMs:llm?.durationMs??null,llmAction:needsClarification?'clarify':'recommend',llmAttempted:manualModelAttempted,consumerWarnings:response.warnings});
        const assistantMessage=manualFollowUp?.message??conversation?.followUp?.message??(llm?.clarify?llm.ack:nearby.alternativeNotice?nearby.alternativeNotice:response.blocked
          ? '這些條件目前無法確認，請查看說明。重新開始可以清除本輪條件。'
          : response.results.length
            ? `${llm?.ack??conversation?.ack??''} 找到 ${response.results.length} 杯符合條件的飲料。你可以繼續調整條件，或說「再推薦幾杯」。`
            : '目前沒有符合所有條件的飲料。你可以調整預算或條件，我不會自動放寬限制。');
        const traceId=crypto.randomUUID();
        const createdAt=new Date().toISOString();
        const record={traceId,createdAt,...trace,...(conversation ? {interface:'conversation',conversation:{message:conversation.message,state:conversation.state,next:conversation.next,assistantMessage,needsClarification,choices:conversation.followUp?.choices??[]}} : {interface:'manual',request:submittedInput,manualUnderstanding:{modelVersion:llm?.modelVersion??null,attempted:manualModelAttempted,assistantMessage:needsClarification?assistantMessage:null,needsClarification}})};
        try {
          await env.TRACE_DB.prepare('INSERT INTO recommendation_traces (id,created_at,query,result_count,payload) VALUES (?,?,?,?,?)').bind(traceId,createdAt,input.query,response.results.length,JSON.stringify(record)).run();
        } catch {
          console.error(JSON.stringify({event:'trace_save_failed',traceId}));
          return json({error:'推薦紀錄暫時無法儲存，請稍後重試'},503);
        }
        console.log(JSON.stringify({event:'recommendation_saved',traceId,resultCount:response.results.length}));
        return json({...response,traceId,...(!conversation?{understandingMode:llm?(llm.modelVersion.startsWith('qwen3.5-9b-')?'qwen3.5-9b':'qwen3-8b'):manualModelAttempted?'rules-fallback':'rules',understandingModel:llm?.modelVersion??null,needsClarification,manualMessage:assistantMessage}:{}),...(conversation?{
          state:conversation.state,next:conversation.next,
          chatMode:llm?(llm.modelVersion.startsWith('qwen3.5-9b-')?'qwen3.5-9b':'qwen3-8b'):conversation.followUp?'clarification':conversation.constraintOnly||conversation.next||conversation.reset?'quick-command':conversation.state.guard?'clarification':'rules-fallback',
          chatModel:llm?.modelVersion??null,needsClarification,assistantMessage,choices:conversation.followUp?.choices??[]
        }:{})});
      }
      return json({error: '找不到此 API 或請求方法不支援'}, 404);
    } catch (error) {
      if (error instanceof Error && !error.message.includes('Internal')) return json({error: error.message}, 400);
      console.error(JSON.stringify({event: 'api_error', path: url.pathname}));
      return json({error: '服務暫時無法使用，請稍後再試'}, 500);
    }
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(refreshTrends(env.TRACE_DB,drinks,catalogVersion).then(result=>{console.log(JSON.stringify({event:'weekly_trends_refresh',...result}));if(result.news==='failed'||result.community==='failed')throw new Error('Weekly trend source refresh failed');}));},
} satisfies ExportedHandler<Env>;
