export type SemanticJob={query:string;candidateIds:string[];catalogVersion:string;topK:number};
export type SemanticReply={scores:Array<{id:string;score:number}>;modelVersion:string;catalogVersion:string;durationMs:number};

export function validateSemanticReply(value:unknown,job:SemanticJob):SemanticReply|null{
  const r=value as SemanticReply|null;
  if(!r||r.catalogVersion!==job.catalogVersion||typeof r.modelVersion!=='string'||r.modelVersion.length>160
    ||typeof r.durationMs!=='number'||!Number.isFinite(r.durationMs)||r.durationMs<0
    ||!Array.isArray(r.scores)||!r.scores.length||r.scores.length>job.topK)return null;
  const allowed=new Set(job.candidateIds),seen=new Set<string>();
  for(const row of r.scores){
    if(!row||typeof row.id!=='string'||!allowed.has(row.id)||seen.has(row.id)||typeof row.score!=='number'||!Number.isFinite(row.score)||Math.abs(row.score)>1.001)return null;
    seen.add(row.id);
  }
  return {...r,scores:[...r.scores].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))};
}
