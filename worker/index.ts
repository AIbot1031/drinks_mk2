import catalog from '../data/catalog.json';
import { makeEngine } from './recommend';
import { validateInput } from './understand';
import type { Drink } from './types';
import { internalApi } from './internal';
import { accountApi, currentUser, storedPreferences } from './accounts';

const drinks: Drink[] = catalog.drinks;
const engine = makeEngine(drinks);
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
      if(url.pathname.startsWith('/api/account/'))return await accountApi(request,env,readBody,drinks);
      if(url.pathname.startsWith('/api/internal/'))return await internalApi(request,env,readBody);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ok: true, total: catalog.total, version: '0.1.0'});
      if (url.pathname === '/api/meta' && request.method === 'GET') return json({total: catalog.total, brands: catalog.brands, missing: catalog.missing, tea: ['紅茶', '綠茶', '青茶', '烏龍茶', '金萱茶', '普洱茶', '蕎麥茶'], toppings: ['珍珠', '椰果', '布丁', '仙草', '燕麥', '粉粿']});
      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        const query = (url.searchParams.get('q') ?? '').slice(0, 100).toLowerCase();
        const brand = url.searchParams.get('brand');
        const parsedPage = Number(url.searchParams.get('page') ?? 1);
        if (!Number.isInteger(parsedPage) || parsedPage < 1 || parsedPage > 1000) return json({error: '頁碼無效'}, 400);
        const pool = drinks.filter(d => (!brand || d.brand === brand) && `${d.name}${d.brand}${d.taste}`.toLowerCase().includes(query));
        return json({total: pool.length, page: parsedPage, pages: Math.ceil(pool.length / 24), results: pool.slice((parsedPage - 1) * 24, parsedPage * 24)});
      }
      if (url.pathname === '/api/recommend' && request.method === 'POST') {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return json({error: '請從本站送出查詢'}, 403);
        const input = validateInput(await readBody(request));
        const user=await currentUser(request,env.TRACE_DB);
        if(user){const prefs=storedPreferences(user.preferences);input.likedIds=prefs.likedIds;input.dislikedIds=prefs.dislikedIds;}
        const {response,trace}=engine.recommendWithTrace(input);
        const traceId=crypto.randomUUID();
        const createdAt=new Date().toISOString();
        const record={traceId,createdAt,...trace};
        try {
          await env.TRACE_DB.prepare('INSERT INTO recommendation_traces (id,created_at,query,result_count,payload) VALUES (?,?,?,?,?)').bind(traceId,createdAt,input.query,response.results.length,JSON.stringify(record)).run();
        } catch {
          console.error(JSON.stringify({event:'trace_save_failed',traceId}));
          return json({error:'推薦紀錄暫時無法儲存，請稍後重試'},503);
        }
        console.log(JSON.stringify({event:'recommendation_saved',traceId,resultCount:response.results.length}));
        return json({...response,traceId});
      }
      return json({error: '找不到此 API 或請求方法不支援'}, 404);
    } catch (error) {
      if (error instanceof Error && !error.message.includes('Internal')) return json({error: error.message}, 400);
      console.error(JSON.stringify({event: 'api_error', path: url.pathname}));
      return json({error: '服務暫時無法使用，請稍後再試'}, 500);
    }
  },
} satisfies ExportedHandler<Env>;
