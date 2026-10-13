import type { Drink } from './types';
import {savePreferencesWithEvents} from './interactions';
const encoder = new TextEncoder();
const cookieName = 'drinks_user_session';
const sessionDays = 7;
const iterations = 100000;
const json = (value: unknown, status = 200, headers: Record<string,string> = {}) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const hex = (buffer: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
async function passwordHash(password:string,salt:string,count:number):Promise<string> {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:count,hash:'SHA-256'},key,256));
}
function tokenFrom(request:Request):string|undefined {
  const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  return token&&/^[a-f0-9]{64}$/.test(token)?token:undefined;
}
export async function currentUser(request:Request,db:D1Database):Promise<{id:string;preferences:string}|null> {
  const token=tokenFrom(request);if(!token)return null;
  return db.prepare('SELECT u.id,u.preferences FROM consumer_sessions s JOIN consumer_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first();
}
export function storedPreferences(value:string):{likedIds:string[];dislikedIds:string[]} {
  return JSON.parse(value);
}
const cookie=(token:string,age=sessionDays*86400)=>`${cookieName}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function createSession(id:string,db:D1Database):Promise<string> {
  const token=random(),now=Date.now();
  await db.batch([
    db.prepare('DELETE FROM consumer_sessions WHERE expires_at<=?').bind(now),
    db.prepare('INSERT INTO consumer_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token),id,now+sessionDays*86400000),
  ]);
  return token;
}
function credentialError(body:unknown):string|undefined {
  const b=body as {id?:unknown;password?:unknown}|null;
  if(!b||typeof b.id!=='string'||b.id.length<3||b.id.length>200||/[^A-Za-z0-9]/.test(b.id))return 'ID 至少 3 個字元，只能使用英文字母或數字';
  if(typeof b.password!=='string'||b.password.length<6||b.password.length>200||/[^A-Za-z0-9]/.test(b.password))return '密碼至少 6 位，只能使用英文大小寫或數字';
}
async function rateAllowed(request:Request,db:D1Database):Promise<boolean> {
  const now=Date.now(),period=15*60000;
  const key=await digest(`consumer-auth:${request.headers.get('CF-Connecting-IP')??'local'}:${Math.floor(now/period)}`);
  const row=await db.prepare('INSERT INTO consumer_auth_limits(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+period).first<{attempts:number}>();
  await db.prepare('DELETE FROM consumer_auth_limits WHERE expires_at<=?').bind(now).run();
  return !!row&&row.attempts<=40;
}
export async function accountApi(request:Request,env:Env,readBody:(r:Request)=>Promise<unknown>,drinks:Drink[]):Promise<Response> {
  const url=new URL(request.url),path=url.pathname;
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'請從本站操作'},403);
  if((path==='/api/account/register'||path==='/api/account/login')&&request.method==='POST'){
    const body=await readBody(request);
    const error=credentialError(body);if(error)return json({error},400);
    if(!await rateAllowed(request,env.TRACE_DB))return json({error:'登入或註冊次數過多，請 15 分鐘後再試'},429,{'Retry-After':'900'});
    const {id,password}=body as {id:string;password:string};
    let user=await env.TRACE_DB.prepare('SELECT password_hash,salt,iterations FROM consumer_users WHERE id=?').bind(id).first<{password_hash:string;salt:string;iterations:number}>();
    if(path.endsWith('/register')){
      if(user)return json({error:'這個 ID 已有人使用，請換一個'},409);
      const salt=random(),hash=await passwordHash(password,salt,iterations);
      const result=await env.TRACE_DB.prepare('INSERT INTO consumer_users(id,password_hash,salt,iterations,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,hash,salt,iterations,Date.now()).run();
      if(!result.meta.changes)return json({error:'這個 ID 已有人使用，請換一個'},409);
    }else{
      // Do the same password derivation even when the account does not exist.
      const actual=await passwordHash(password,user?.salt??'unknown-account-salt',user?.iterations??iterations);
      const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(actual)),crypto.subtle.digest('SHA-256',encoder.encode(user?.password_hash??''))]);
      if(!crypto.subtle.timingSafeEqual(a,b)||!user)return json({error:'ID 或密碼不正確'},401);
    }
    const oldToken=tokenFrom(request);if(oldToken)await env.TRACE_DB.prepare('DELETE FROM consumer_sessions WHERE token_hash=?').bind(await digest(oldToken)).run();
    const token=await createSession(id,env.TRACE_DB);
    return json({user:{id}},path.endsWith('/register')?201:200,{'Set-Cookie':cookie(token)});
  }
  if(path==='/api/account/logout'&&request.method==='POST'){
    const token=tokenFrom(request);if(token)await env.TRACE_DB.prepare('DELETE FROM consumer_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  const user=await currentUser(request,env.TRACE_DB);
  if(path==='/api/account/me'&&request.method==='GET')return json({user:user?{id:user.id}:null});
  if(!user)return json({error:'請先登入你的帳號'},401);
  if(path==='/api/account/preferences'){
    if(request.method==='PUT'){
      const body=await readBody(request) as {likedIds?:unknown;dislikedIds?:unknown}|null;
      const known=new Set(drinks.map(d=>d.id));
      if(!body||![body.likedIds,body.dislikedIds].every(a=>Array.isArray(a)&&a.length<=200&&a.every(id=>typeof id==='string'&&known.has(id))))return json({error:'偏好須使用有效飲料 ID，每種最多 200 款'},400);
      const likedIds=[...new Set(body.likedIds as string[])],dislikedIds=[...new Set(body.dislikedIds as string[])].filter(id=>!likedIds.includes(id));
      await savePreferencesWithEvents(env.TRACE_DB,user.id,likedIds,dislikedIds);
      user.preferences=JSON.stringify({likedIds,dislikedIds});
    }else if(request.method!=='GET')return json({error:'請求方法不支援'},405);
    const prefs=storedPreferences(user.preferences),liked=Object.fromEntries(prefs.likedIds.map(id=>[id,drinks.find(d=>d.id===id)]).filter(([,d])=>!!d));
    return json({version:1,liked,disliked:prefs.dislikedIds.filter(id=>drinks.some(d=>d.id===id))});
  }
  return json({error:'找不到帳號 API'},404);
}
