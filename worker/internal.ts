const json = (body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookieName='drinks_team_session';
const encoder=new TextEncoder();
async function sign(value:string,key:string):Promise<string> {
  const k=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',k,encoder.encode(value));
  return Array.from(new Uint8Array(signature),v=>v.toString(16).padStart(2,'0')).join('');
}
async function constantEqual(a:string,b:string):Promise<boolean> {
  const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);
  return crypto.subtle.timingSafeEqual(x,y);
}
async function authorized(request:Request,key:string):Promise<boolean> {
  const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!token || token.length>250) return false;
  const [expiry,nonce,signature]=token.split('.');
  if(!expiry||!nonce||!signature||!/^\d+$/.test(expiry)||Number(expiry)<Date.now())return false;
  return constantEqual(signature,await sign(`${expiry}.${nonce}`,key));
}
export async function internalApi(request:Request,env:Env,bodyReader:(r:Request)=>Promise<unknown>):Promise<Response> {
  const url=new URL(request.url);
  if(!env.REVIEW_KEY||!env.REVIEW_ID)return json({error:'團隊檢查密碼尚未設定'},503);
  const origin=request.headers.get('origin');
  if(origin&&origin!==url.origin)return json({error:'請從本站操作'},403);
  if(url.pathname==='/api/internal/login'&&request.method==='POST'){
    const body=await bodyReader(request) as {id?:unknown;password?:unknown};
    if(!body||typeof body.id!=='string'||body.id.length<3||body.id.length>200||/[^A-Za-z0-9]/.test(body.id))return json({error:'ID 至少 3 個字元，只能使用英文字母或數字'},400);
    if(typeof body.password!=='string'||body.password.length<6||body.password.length>200||/[^A-Za-z0-9]/.test(body.password))return json({error:'密碼至少 6 位，只能使用英文大小寫或數字'},400);
    const [idMatches,passwordMatches]=await Promise.all([constantEqual(body.id,env.REVIEW_ID),constantEqual(body.password,env.REVIEW_KEY)]);
    if(!idMatches||!passwordMatches)return json({error:'ID 或密碼不正確'},401);
    const data=`${Date.now()+8*60*60*1000}.${crypto.randomUUID()}`;
    const token=`${data}.${await sign(data,env.REVIEW_KEY)}`;
    return json({ok:true},200,{'Set-Cookie':`${cookieName}=${token}; Path=/api/internal; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`});
  }
  if(!await authorized(request,env.REVIEW_KEY))return json({error:'請先登入團隊檢查頁面'},401);
  if(url.pathname==='/api/internal/logout'&&request.method==='POST')return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/api/internal; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
  if(url.pathname==='/api/internal/traces'&&request.method==='GET'){
    const q=(url.searchParams.get('q')??'').slice(0,100);
    const result=await env.TRACE_DB.prepare('SELECT id, created_at, query, result_count FROM recommendation_traces WHERE query LIKE ? ORDER BY created_at DESC LIMIT 50').bind(`%${q}%`).all();
    return json({results:result.results});
  }
  const match=url.pathname.match(/^\/api\/internal\/traces\/([a-f0-9-]{36})$/);
  if(match&&request.method==='GET'){
    const row=await env.TRACE_DB.prepare('SELECT payload FROM recommendation_traces WHERE id=?').bind(match[1]).first<{payload:string}>();
    return row ? json(JSON.parse(row.payload)) : json({error:'查無這筆推薦紀錄'},404);
  }
  return json({error:'找不到檢查 API'},404);
}
