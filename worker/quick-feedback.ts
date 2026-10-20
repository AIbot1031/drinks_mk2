import type {Drink} from './types';
import {readRegion} from './regions';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function feedbackInput(value:unknown,drinks:Drink[]){
 const v=value as Record<string,unknown>;
 if(!v||typeof v.id!=='string'||!uuid.test(v.id)||typeof v.reporterId!=='string'||!uuid.test(v.reporterId)
  ||!['menu','region','recommendation','other'].includes(v.kind as string)||typeof v.message!=='string'
  ||!v.message.trim()||v.message.trim().length>1000)throw Error('請選擇回報類型並填寫 1～1000 字說明。');
 const scope=readRegion(v.region),drink=v.drinkId===undefined||v.drinkId===''?undefined:drinks.find(d=>d.id===v.drinkId);
 if(v.drinkId&&!drink)throw Error('回報品項不在目前目錄，請重新選擇。');
 if(v.traceId!==undefined&&(typeof v.traceId!=='string'||!uuid.test(v.traceId)))throw Error('推薦紀錄格式有誤。');
 return {id:v.id,reporterId:v.reporterId,kind:v.kind as string,message:v.message.trim(),
  context:{region:scope?{city:scope.city,district:scope.district}:null,
   ...(drink?{drinkId:drink.id,brand:drink.brand,name:drink.name}:{}),...(v.traceId?{traceId:v.traceId}:{})}};
}
export async function submitQuickFeedback(db:D1Database,value:unknown,drinks:Drink[]){
 const v=feedbackInput(value,drinks),now=Date.now();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v.reporterId));
 const reporter=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const existing=await db.prepare('SELECT reporter_hash FROM quick_feedback WHERE id=?').bind(v.id).first<{reporter_hash:string}>();
 if(existing){if(existing.reporter_hash!==reporter)throw Error('回報識別碼不符。');return {ok:true,id:v.id,pending:true};}
 const result=await db.prepare(`INSERT OR IGNORE INTO quick_feedback(id,kind,message,context_json,reporter_hash,created_at)
 SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM quick_feedback WHERE created_at>?)<200
 AND (SELECT COUNT(*) FROM quick_feedback WHERE reporter_hash=? AND created_at>?)<20`)
 .bind(v.id,v.kind,v.message,JSON.stringify(v.context),reporter,now,now-86400000,reporter,now-86400000).run();
 if(!result.meta.changes)throw Error('今日回報較多，請稍後再試。');
 return {ok:true,id:v.id,pending:true};
}
