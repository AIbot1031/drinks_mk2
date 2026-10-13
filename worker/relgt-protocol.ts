export type RelgtHistory={drinkId:string;action:'like'|'dislike'|'unlike'|'undislike';occurredAt:number};
export type RelgtJob={userCode:string;at:number;history:RelgtHistory[];candidateIds:string[];catalogVersion:string;topK:number};
export type RelgtReply={scores:Array<{id:string;score:number}>;modelVersion:string;catalogVersion:string;durationMs:number;historyCount:number;fallbackReason?:string};

export function validateRelgtReply(value:unknown,job:RelgtJob):RelgtReply|null{
  const r=value as RelgtReply|null;
  if(!r||r.catalogVersion!==job.catalogVersion||typeof r.modelVersion!=='string'||!/^relgt-temporal-[a-f0-9]{16}$/.test(r.modelVersion)
    ||typeof r.durationMs!=='number'||!Number.isFinite(r.durationMs)||r.durationMs<0||r.historyCount!==job.history.length||!Array.isArray(r.scores))return null;
  if(r.fallbackReason!==undefined)return ['new_user','no_history'].includes(r.fallbackReason)&&!r.scores.length?r:null;
  if(!r.scores.length||r.scores.length>job.topK)return null;
  const allowed=new Set(job.candidateIds),seen=new Set<string>();
  for(const row of r.scores){
    if(!row||!allowed.has(row.id)||seen.has(row.id)||typeof row.score!=='number'||!Number.isFinite(row.score))return null;
    seen.add(row.id);
  }
  return {...r,scores:[...r.scores].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))};
}

export async function anonymousRelgtUser(id:string,keyHex:string){
  if(!/^[a-f0-9]{64}$/.test(keyHex))throw new Error('RelGT pseudonym key unavailable');
  const bytes=Uint8Array.from(keyHex.match(/../g)!,s=>parseInt(s,16));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id));
  return 'u_'+Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
}
