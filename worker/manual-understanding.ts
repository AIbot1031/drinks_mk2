import {conversationTurn} from './conversation';
import {applyLlmUnderstanding} from './llm-conversation';
import {understand,validateInput} from './understand';
import {capFields,exclusiveKeys,flavorQuery} from './numeric-language';
import {requiredToppings,setRequiredToppings} from './drink-language';
import type {Filters,RecommendInput} from './types';

// Manual form selections and verified text constraints remain hard boundaries.
export function lockManualFilters(baseline:Filters,candidate:Filters):Filters {
 const merged:Filters={...candidate};
 for(const field of ['brand','tea','milk','milkTea'] as const){const value=baseline[field];if(value!==undefined&&value!==''&&value!=='any')Object.assign(merged,{[field]:value});}
 for(const field of capFields){const n=baseline[field];if(n!==undefined){const m=merged[field];if(m===undefined||n<m){merged[field]=n;merged[exclusiveKeys[field]]=baseline[exclusiveKeys[field]];}else if(n===m)merged[exclusiveKeys[field]]=!!baseline[exclusiveKeys[field]]||!!merged[exclusiveKeys[field]]||undefined;}}
 merged.excludedBrands=[...new Set([...(baseline.excludedBrands??[]),...(candidate.excludedBrands??[])])];
 merged.excludedToppings=[...new Set([...(baseline.excludedToppings??[]),...(candidate.excludedToppings??[])])];
 setRequiredToppings(merged,[...requiredToppings(baseline),...requiredToppings(candidate)]);
 return merged;
}
export function prepareManualUnderstanding(original:RecommendInput,brands:string[]){
 const rules=understand(original,brands);
 const turn=conversationTurn({message:original.query,state:{query:'',filters:original.filters,guard:''}},brands);
 turn.state.filters=lockManualFilters(rules.filters,turn.state.filters);
 // These are plain manual search words, not chat commands that clear the form.
 if(turn.reset||turn.next){turn.state.query=flavorQuery(original.query);turn.state.guard='';}
 turn.reset=false;turn.next=false;
 turn.input=validateInput({...original,query:rules.blocked?original.query:turn.state.guard||turn.state.query,filters:turn.state.filters});
 return {original,rules,turn};
}
export function applyManualUnderstanding(prepared:ReturnType<typeof prepareManualUnderstanding>,value:unknown,brands:string[],tea:string[],toppings:string[]){
 const parsed=applyLlmUnderstanding(prepared.turn,value,brands,tea,toppings);if(!parsed)return null;
 const filters=lockManualFilters(prepared.turn.state.filters,parsed.state.filters);
 return {...parsed,state:{...parsed.state,filters},input:validateInput({...prepared.original,query:prepared.rules.blocked?prepared.original.query:parsed.state.guard||parsed.state.query,filters})};
}
