import type {Drink} from './types';
import {toppingTerms} from './drink-language';
export const featureSchemaVersion='drink-catalog-v1';
export function catalogFeatures(drinks:Drink[]){
  const values=(key:'tea'|'milk'|'toppings')=>[...new Set(drinks.flatMap(d=>d[key]))].sort();
  return {version:featureSchemaVersion,tea:values('tea'),milkTags:values('milk'),toppings:values('toppings'),supportedExclusions:toppingTerms,
    flavorExamples:['清爽','回甘','果香','酸甜','濃郁','奶香','嚼勁','提神','茶香','花香'],
    fields:{query:'自由口味文字，對照飲料名稱與 taste 風味描述，以 MacBERT 做語意排序。',
      milk:'any=不限；none=資料標記無奶且無已知奶衝突；fresh=鮮奶；plant=植物奶且排除已標記鮮奶或奶精。無奶不代表過敏安全。',
      milkTea:'名稱為奶茶，或同時有奶類與茶種標記；珍奶不要珍為 milkTea=true 並 excludedToppings=[珍珠]。',
      tea:'只用提供的實際茶種；紅茶拿鐵仍是紅茶及鮮奶，不等於咖啡。',
      topping:'想要的配料；excludedToppings 為不要的配料，排除優先，珍珠與波霸視為同類。',
      brand:'指定品牌；excludedBrands 為排除品牌，只用提供的品牌名稱。',
      maxPrice:'每杯價格上限，僅使用使用者指定數字，同品項不同杯型或地區的符合條件版本預設最低價。',
      maxCalories:'每杯熱量 kcal 上限；資料缺失不視為零。',
      maxCaffeine:'每杯咖啡因 mg 上限，篩選採資料上界；資料缺失不視為零。'},
    boundaries:'資料沒有可驗證的客製糖度、冰量及過敏安全；不得宣稱已符合。LLM 只解析意圖，不生成飲料、价格或營養事實。'};
}

export function preferenceProfile(drinks:Drink[],likedIds:string[],dislikedIds:string[]){
  const liked=new Set(likedIds),disliked=new Set(dislikedIds);
  const examples=(ids:Set<string>)=>drinks.filter(d=>ids.has(d.id)).slice(0,10).map(d=>({name:d.name,brand:d.brand,tea:d.tea,milk:d.milk,toppings:d.toppings,taste:d.taste.slice(0,100)}));
  return {liked:examples(liked),disliked:examples(disliked),instruction:'收藏是口味參考，不能蓋過本輪需求。不喜歡單一飲料不等於排除整個品牌。'};
}
export function chatHistory(value:unknown){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>8)throw new Error('最近對話最多 8 則');
  return value.map(item=>{
    if(!item||typeof item!=='object'||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||item.content.length>300)throw new Error('最近對話格式有誤');
    return {role:item.role as 'user'|'assistant',content:item.content};
  });
}
