// Synthetic, independently authored website-contract scenarios. No user data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {conversationTurn} from '../worker/conversation';
import {catalogFeatures} from '../worker/catalog-features';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),drinks=catalog.drinks;
const developmentDefinitions=[
  {id:'brand-no',group:'brand_exclusion',prior:['我想喝奶茶'],message:'春水堂先排除，預算75元',action:'recommend'},
  {id:'brand-allow',group:'brand_release',prior:['奶茶，預算75元，不要春水堂和星巴克'],message:'春水堂可以了',action:'recommend'},
  {id:'pearl-no',group:'topping_exclusion',prior:['想喝奶茶，預算80元'],message:'這次不放珍珠',action:'recommend'},
  {id:'pearl-allow',group:'topping_release',prior:['奶茶，預算80元，不要珍珠和布丁'],message:'珍珠可以了',action:'recommend'},
  {id:'budget-up',group:'numeric',prior:['奶茶，預算50元，不要一沐日'],message:'預算改成95元',action:'recommend'},
  {id:'caffeine-off',group:'numeric',prior:['綠茶，預算60元，晚上喝'],message:'咖啡因不限',action:'recommend'},
  {id:'pure-tea',group:'cross_turn',prior:['奶茶，預算80元，不要春水堂'],message:'改喝純綠茶，不要奶茶',action:'recommend'},
  {id:'fresh-milk',group:'cross_turn',prior:['奶茶，預算80元，不要奶蓋'],message:'改成鮮奶',action:'recommend'},
  {id:'clarify-taste',group:'clarify',prior:[],message:'想喝飲料',action:'clarify'},
  {id:'unknown-topping',group:'clarify',prior:['想喝奶茶，預算80元'],message:'不要奇怪配料',action:'clarify'},
  {id:'cream-no',group:'topping_exclusion',prior:['想喝紅茶，預算70元'],message:'這杯不加奶蓋',action:'recommend'},
  {id:'brand-more',group:'brand_exclusion',prior:['想喝奶茶，不要春水堂，預算90元'],message:'星巴克也不要',action:'recommend'},
  {id:'milk-no',group:'category_exclusion',prior:[],message:'不喜歡奶茶',action:'clarify'},
  {id:'milk-no-green',group:'category_exclusion',prior:[],message:'不喜歡奶茶，但想喝綠茶，預算80元',action:'recommend'},
  {id:'milk-no-prior',group:'category_exclusion',prior:['奶茶，預算80元，不要春水堂'],message:'我不喜歡奶茶',action:'clarify'},
  {id:'milk-release',group:'category_release',prior:['不喜歡奶茶，但想喝綠茶，預算80元'],message:'奶茶可以了',action:'recommend'},
  {id:'milk-choose',group:'category_release',prior:['不喜歡奶茶，但想喝綠茶，預算80元'],message:'改喝奶茶',action:'recommend'},
  {id:'pearl-contradiction',group:'topping_exclusion',prior:[],message:'珍奶但是不要珍',action:'recommend'},
  {id:'pure-red',group:'cross_turn',prior:['奶茶，預算80元，不要春水堂'],message:'改喝純紅茶，不要奶茶',action:'recommend'},
  {id:'brand-dislike',group:'brand_exclusion',prior:[],message:'我不喜歡春水堂，想喝紅茶，預算70元',action:'recommend'},
  {id:'all-caps',group:'numeric',prior:[],message:'想喝紅茶，預算60元，熱量100以下，咖啡因50以下',action:'recommend'},
];
// These cases are held out from the prompt repair and never training targets.
const holdoutDefinitions=[
  {id:'h-milk-only',group:'category_exclusion',prior:[],message:'奶茶先不要',action:'clarify'},
  {id:'h-milk-prior',group:'category_exclusion',prior:['奶茶不要珍珠，預算95元，排除春水堂'],message:'我不喜歡奶茶',action:'clarify'},
  {id:'h-red-no-milk',group:'category_exclusion',prior:[],message:'不喜歡奶茶，想喝紅茶，不要春水堂，預算60元',action:'recommend'},
  {id:'h-brand-release',group:'brand_release',prior:['不喜歡星巴克，想喝烏龍茶，預算85元'],message:'星巴克可以了',action:'recommend'},
  {id:'h-pearl-release',group:'topping_release',prior:['紅茶，不要珍珠，預算65元'],message:'珍珠可以了',action:'recommend'},
  {id:'h-caffeine-release',group:'numeric',prior:['紅茶，咖啡因50以下，預算75元'],message:'咖啡因不限',action:'recommend'},
  {id:'h-budget',group:'numeric',prior:['綠茶，預算65元，不要一沐日'],message:'預算改成90元',action:'recommend'},
  {id:'h-green-no-milk',group:'category_exclusion',prior:['烏龍茶，預算85元，不要星巴克'],message:'奶茶我不喜歡',action:'recommend'},
];
const heldout=process.argv[3]==='holdout';
const definitions=heldout?holdoutDefinitions:developmentDefinitions;
const cases=definitions.map(d=>{
  let state:any;
  for(const message of d.prior)state=conversationTurn({message,state},brands).state;
  const turn=conversationTurn({message:d.message,state},brands);
  return {id:d.id,group:d.group,expectedAction:d.action,turn,job:{message:d.message,state:turn.state,
    brands,tea:[...new Set(drinks.flatMap(d=>d.tea))],toppings:[...new Set(drinks.flatMap(d=>d.toppings))],
    catalogFeatures:catalogFeatures(drinks),history:[],preferenceProfile:{}}};
});
const byId=(id:string)=>cases.find(c=>c.id===id)!;
if(!heldout){
  assert.ok(byId('brand-no').turn.state.filters.excludedBrands?.includes('春水堂'));
  assert.equal(byId('brand-no').turn.state.filters.brand,undefined);
  assert.deepEqual(byId('brand-allow').turn.state.filters.excludedBrands,['星巴克']);
  assert.equal(byId('brand-allow').turn.state.filters.brand,undefined);
  assert.ok(byId('brand-more').turn.state.filters.excludedBrands?.includes('星巴克'));
}
const output=process.argv[2]??'.wrangler/model-comparison';
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(output+'/qwen-fixtures.json',JSON.stringify(cases,null,2));
console.log(`Website fixtures: ${cases.length}`);
