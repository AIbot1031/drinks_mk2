export function traceSummary(trace={}) {
 const output=trace.consumerOutput??{},understanding=trace.understanding??{},a=trace.routeA??{},b=trace.routeB??{};
 const results=output.results??[],clarifying=understanding.llmAction==='clarify'||!!trace.conversation?.state?.clarification;
 const issues=[];
 if(!clarifying&&(understanding.blocked||output.blocked))issues.push({kind:'warning',text:'條件被阻擋',detail:'查看解析提醒，系統沒有放寬限制。'});
 if(clarifying)issues.push({kind:'info',text:'等待使用者釐清',detail:'本輪未提供推薦，先確認缺少或含糊的條件。'});
 if(!results.length&&!clarifying&&!understanding.blocked&&!output.blocked)issues.push({kind:'warning',text:'沒有推薦結果',detail:'檢查硬篩選剩餘數量、排除及換批紀錄。'});
 if(a.fallbackReason)issues.push({kind:'warning',text:'A 路徑使用備援',detail:a.fallbackReason});
 if(b.fallbackReason&&b.fallbackReason!=='guest'&&b.fallbackReason!=='no_history')issues.push({kind:'warning',text:'B 路徑使用備援',detail:b.fallbackReason});
 return {results,clarifying,issues,routeA:a.modelVersion??a.method??'未記錄',routeB:b.modelVersion??b.method??'未記錄',query:trace.conversation?.message||trace.input?.query||'只設定篩選條件',version:trace.engineVersion??'未記錄'};
}
export function listSummary(rows=[]) {return {total:rows.length,withResults:rows.filter(r=>r.result_count>0).length,empty:rows.filter(r=>r.result_count===0).length};}
export function modelState(value) {return !value?'未取得':value.connected&&value.ready?'就緒':value.connected?'已連線・準備中':'未連線';}

export function interactionSummary(trace={}) {
 const chat=trace.interface==='conversation'||!!trace.conversation;
 return {chat,input:chat?trace.conversation?.message:trace.request?.query??trace.input?.query,
  originalSaved:chat?typeof trace.conversation?.message==='string':typeof trace.request?.query==='string',
  selectedFilters:trace.request?.filters??trace.input?.filters??{},
  reply:chat&&typeof trace.conversation?.assistantMessage==='string'?trace.conversation.assistantMessage:null,
  results:trace.consumerOutput?.results??[]};
}
