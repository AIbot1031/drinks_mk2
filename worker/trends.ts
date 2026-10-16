import {productKey} from './products';
import type {Drink} from './types';
const DAY=86400000;
export const NEWS_QUERY='"bubble tea" sourcecountry:Taiwan';
export type TrendRow={key:string;name:string;brand?:string;count:number;rank:number;previousRank:number|null;sources:{url:string;domain:string;seenAt:string}[]};
export type TrendSnapshot={kind:'news'|'community';generatedAt:string;periodStart:string;periodEnd:string;rows:TrendRow[];sampleCount:number;participants?:number;truncated?:boolean;catalogVersion:string};
type Event={user_id:string;drink_id:string;action:string;occurred_at:number;id:string};
export function nextWeeklyUpdate(now:number){const d=new Date(now);d.setUTCHours(18,0,0,0);d.setUTCDate(d.getUTCDate()+((7-d.getUTCDay())%7));if(d.getTime()<=now)d.setUTCDate(d.getUTCDate()+7);return d.toISOString();}
export function rankRows(rows:Omit<TrendRow,'rank'|'previousRank'>[],previous:TrendSnapshot|null){
 const sorted=rows.filter(r=>r.count>0).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
 let rank=0;return sorted.map((r,i)=>{if(!i||r.count!==sorted[i-1].count)rank=i+1;return {...r,rank,previousRank:previous?.rows.find(p=>p.key===r.key)?.rank??null};});
}
export function communityRows(events:Event[],drinks:Drink[],start:number,end:number){
 const byId=new Map(drinks.map(d=>[d.id,d])),latest=new Map<string,{d:Drink;event:Event}>(),people=new Set<string>();
 // Latest event wins across cup sizes; callers sort by timestamp then event ID.
 for(const e of [...events].sort((a,b)=>a.occurred_at-b.occurred_at||a.id.localeCompare(b.id))){const d=byId.get(e.drink_id);if(!d||e.occurred_at<start||e.occurred_at>=end||!['like','unlike','dislike','undislike'].includes(e.action))continue;people.add(e.user_id);latest.set(JSON.stringify([e.user_id,productKey(d)]),{d,event:e});}
 const counts=new Map<string,Omit<TrendRow,'rank'|'previousRank'>>();
 for(const {d,event} of latest.values()){if(event.action!=='like')continue;const key=productKey(d),r=counts.get(key)??{key,name:d.name,brand:d.brand,count:0,sources:[]};r.count++;counts.set(key,r);}
 return {rows:[...counts.values()],participants:people.size,sampleCount:[...counts.values()].reduce((n,r)=>n+r.count,0)};
}
export function newsRows(value:unknown,brands:string[],start:number,end:number){
 if(!value||typeof value!=='object'||!Array.isArray((value as {articles?:unknown}).articles))throw new Error('invalid_source');
 const articles=(value as {articles:unknown[]}).articles;if(articles.length>250)throw new Error('invalid_source');
 const seenUrls=new Set<string>(),seenTitles=new Set<string>(),counts=new Map<string,Omit<TrendRow,'rank'|'previousRank'>>();let sampleCount=0;
 for(const item of articles){if(!item||typeof item!=='object')continue;const a=item as Record<string,unknown>;
  if(typeof a.url!=='string'||typeof a.title!=='string'||typeof a.seendate!=='string')continue;
  let u:URL;try{u=new URL(a.url);}catch{continue;}if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>2000)continue;
  const date=a.seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);if(!date)continue;
  const seenAt=`${date[1]}-${date[2]}-${date[3]}T${date[4]}:${date[5]}:${date[6]}Z`,at=Date.parse(seenAt);if(!Number.isFinite(at)||at<start||at>=end)continue;
  u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(k))u.searchParams.delete(k);
  const title=a.title.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'').toLowerCase();if(!title||seenUrls.has(u.href)||seenTitles.has(title))continue;
  seenUrls.add(u.href);seenTitles.add(title);sampleCount++;
  for(const brand of brands){if(!a.title.includes(brand))continue;const r=counts.get(brand)??{key:brand,name:brand,count:0,sources:[]};r.count++;r.sources.push({url:u.href,domain:u.hostname,seenAt});counts.set(brand,r);}
 }
 return {rows:[...counts.values()],sampleCount,truncated:articles.length===250};
}
async function limitedJson(response:Response){
 if(!response.ok)throw new Error('source_unavailable');if(!response.body)throw new Error('invalid_source');
 const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2_000_000)throw new Error('source_too_large');chunks.push(value);}}finally{await reader.cancel();}
 const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new Error('invalid_source');}
}
async function load<T>(db:D1Database,id:string){const r=await db.prepare('SELECT payload FROM weekly_trends WHERE id=?').bind(id).first<{payload:string}>();return r?JSON.parse(r.payload) as T:null;}
async function save(db:D1Database,id:string,payload:unknown,now:number){await db.prepare('INSERT INTO weekly_trends(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(id,JSON.stringify(payload),now).run();}
async function storeSnapshot(db:D1Database,snapshot:TrendSnapshot,now:number){
 const kind=snapshot.kind,old=await load<TrendSnapshot>(db,kind+'-current');
 if(old&&now-Date.parse(old.generatedAt)>=6*DAY)await save(db,kind+'-previous',old,now);
 const prev=await load<TrendSnapshot>(db,kind+'-previous');
 const comparable=prev&&Math.abs(Date.parse(snapshot.periodStart)-Date.parse(prev.periodEnd))<DAY?prev:null;
 snapshot.rows=rankRows(snapshot.rows,comparable);
 await save(db,kind+'-current',snapshot,now);await save(db,kind+'-attempt',{at:new Date(now).toISOString(),status:'success'},now);
}
export async function refreshTrends(db:D1Database,drinks:Drink[],catalogVersion:string,now=Date.now(),fetcher:typeof fetch=fetch){
 const token=crypto.randomUUID(); // Lease prevents concurrent cron and manual refreshes.
 const acquired=await db.prepare('UPDATE trend_refresh_lock SET locked_until=? WHERE id=1 AND locked_until<? RETURNING id').bind(now+120000,now).first();
 if(!acquired)return {status:'busy',news:'not_run',community:'not_run'};
 const result:{status:string;news:string;community:string}={status:'completed',news:'pending',community:'pending'};
 const start=now-7*DAY,base={generatedAt:new Date(now).toISOString(),periodStart:new Date(start).toISOString(),periodEnd:new Date(now).toISOString(),catalogVersion};
 try{
  for(const kind of ['community','news'] as const){try{
   let snapshot:TrendSnapshot;
   if(kind==='community'){
    const r=await db.prepare('SELECT id,user_id,drink_id,action,occurred_at FROM consumer_interactions WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at,id LIMIT 10001').bind(start,now).all<Event>();if(r.results.length>10000)throw new Error('sample_limit');
    const c=communityRows(r.results,drinks,start,now);snapshot={...base,kind,...c,rows:rankRows(c.rows,null)};
   }else{
    const url=new URL('https://api.gdeltproject.org/api/v2/doc/doc');for(const [k,v] of Object.entries({query:NEWS_QUERY,mode:'artlist',format:'json',maxrecords:'250',sort:'datedesc',startdatetime:base.periodStart.replace(/[-:TZ.]/g,'').slice(0,14),enddatetime:base.periodEnd.replace(/[-:TZ.]/g,'').slice(0,14)}))url.searchParams.set(k,v);
    const response=await fetcher(url,{signal:AbortSignal.timeout(20000),redirect:'error'});const n=newsRows(await limitedJson(response),[...new Set(drinks.map(d=>d.brand))],start,now);snapshot={...base,kind,...n,rows:rankRows(n.rows,null)};
   }
   await storeSnapshot(db,snapshot,now);result[kind]='success';
  }catch{await save(db,kind+'-attempt',{at:new Date(now).toISOString(),status:'failed',reason:kind==='news'?'source_unavailable':'aggregation_failed'},now);result[kind]='failed';console.error(JSON.stringify({event:'weekly_trends_failed',kind,attempt:token}));}}
 }finally{await db.prepare('UPDATE trend_refresh_lock SET locked_until=? WHERE id=1 AND locked_until=?').bind(now+60000,now+120000).run();}
 return result;
}
export async function publicTrends(db:D1Database,now=Date.now()){
 const [news,community,newsAttempt,communityAttempt]=await Promise.all([load<TrendSnapshot>(db,'news-current'),load<TrendSnapshot>(db,'community-current'),load(db,'news-attempt'),load(db,'community-attempt')]);
 return {news,community,newsAttempt,communityAttempt,nextUpdate:nextWeeklyUpdate(now),schedule:'每週一 02:00（台北時間）',newsSource:{name:'GDELT DOC 2.0',url:'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/',query:NEWS_QUERY},stale:{news:!news||now-Date.parse(news.generatedAt)>8*DAY,community:!community||now-Date.parse(community.generatedAt)>8*DAY}};
}
