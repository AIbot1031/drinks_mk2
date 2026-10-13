import {normalizeDrinkLanguage, stripToppingExclusions, sameTopping, toppingTerms} from './drink-language';
import type { Filters, RecommendInput, Understanding } from './types';
import {stripBrandExclusions} from './brand-language';

const bounded = (value: unknown, name: string, max: number): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${name}超出有效範圍`);
  return value;
};
export function validateInput(value: unknown): RecommendInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('請提供 JSON 物件');
  const v = value as Record<string, unknown>;
  if (typeof v.query !== 'string' || v.query.length > 300) throw new Error('需求文字最多 300 字');
  if (v.filters !== undefined && (!v.filters || typeof v.filters !== 'object' || Array.isArray(v.filters))) throw new Error('篩選條件格式有誤');
  const f = (v.filters ?? {}) as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    if (f[key] === undefined || f[key] === '') return undefined;
    if (typeof f[key] !== 'string' || f[key].length > 60) throw new Error('篩選欄位格式有誤');
    return f[key];
  };
  const excludedBrands = f.excludedBrands ?? [];
  if(!Array.isArray(excludedBrands)||excludedBrands.length>50||excludedBrands.some(b=>typeof b!=='string'||!b.trim()||b.length>60))throw new Error('排除品牌須為品牌名稱清單，最多 50 個');
  const milk = str('milk');
  const excludedToppings=f.excludedToppings??[];
  if(!Array.isArray(excludedToppings)||excludedToppings.length>20||excludedToppings.some(t=>typeof t!=='string'||!toppingTerms.includes(t)))throw new Error('排除配料選項無效');
  if(f.milkTea!==undefined&&typeof f.milkTea!=='boolean')throw new Error('奶茶條件格式有誤');
  if (milk && !['any', 'none', 'fresh', 'plant'].includes(milk)) throw new Error('奶類選項無效');
  const ids = (key: string, max = 200): string[] => {
    const values = v[key] ?? [];
    if (!Array.isArray(values) || values.length > max || values.some(id => typeof id !== 'string' || id.length > 80)) throw new Error('回饋資料格式有誤');
    return [...new Set(values)] as string[];
  };
  const limit = v.limit ?? 6;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('推薦數量須介於 1 至 20');
  return {query: v.query.trim(), filters: {brand: str('brand'), excludedBrands: [...new Set(excludedBrands.map(b=>b.trim()))],excludedToppings:[...new Set(excludedToppings)],milkTea:f.milkTea as boolean|undefined,maxPrice: bounded(f.maxPrice, '預算', 10000), maxCalories: bounded(f.maxCalories, '熱量', 10000), maxCaffeine: bounded(f.maxCaffeine, '咖啡因', 10000), milk: milk as Filters['milk'], tea: str('tea'), topping: str('topping')}, likedIds: ids('likedIds'), dislikedIds: ids('dislikedIds'), excludedIds: ids('excludedIds', 2000), limit};
}

export function understand(input: RecommendInput, brands: string[]): Understanding {
  let q = normalizeDrinkLanguage(input.query);
  const filters = {...input.filters};
  const excluded=new Set(filters.excludedBrands??[]);
  q=stripBrandExclusions(q,brands,b=>excluded.add(b));
  filters.excludedBrands=[...excluded];
  const warnings: string[] = [];
  if(filters.excludedBrands?.some(b=>!brands.includes(b))){warnings.push('排除品牌中有不支援的名稱，請從品牌選單重新選擇。');return {filters,warnings,blocked:true,preferences:[]};}
  const cap = (key: 'maxPrice' | 'maxCalories' | 'maxCaffeine', n: number) => filters[key] = Math.min(filters[key] ?? Infinity, n);
  const price = q.match(/(?:預算|價格|價錢)\s*(?:不超過|最多|上限)?\s*(\d+(?:\.\d+)?)/) ?? q.match(/(?:不超過|最多|上限)\s*(\d+(?:\.\d+)?)\s*(?:元|塊)/);
  const price2 = q.match(/(\d+(?:\.\d+)?)\s*(?:元|塊)\s*(?:以下|內|以內)/);
  if (price || price2) cap('maxPrice', Number((price ?? price2)![1]));
  const cal = q.match(/(?:熱量|卡路里)\s*(?:不超過|最多|低於|小於|上限)?\s*(\d+(?:\.\d+)?)/);
  const caf = q.match(/咖啡因\s*(?:不超過|最多|低於|小於|上限)?\s*(\d+(?:\.\d+)?)/);
  if (cal) cap('maxCalories', Number(cal[1]));
  else if (/低(?:熱量|卡)/.test(q)) {cap('maxCalories', 200); warnings.push('「低熱量」先採每杯 200 kcal 以下，可在篩選中調整。');}
  if (caf) cap('maxCaffeine', Number(caf[1]));
  else if (/無咖啡因|不含咖啡因|不要咖啡因/.test(q)) cap('maxCaffeine', 0);
  else if (/低咖啡因|晚上|睡前/.test(q)) {cap('maxCaffeine', 100); warnings.push('此查詢採咖啡因上界 100 mg 以下；這不是睡眠或健康保證。');}
  const noMilk = /(?:不要|不含|不加|不能喝|不喝|無)(?:任何|一點)?(?:奶類|乳製品|牛奶|奶(?!精|蓋)|乳)/.test(q);
  if((/鮮奶/.test(q)&&filters.milk==='plant')||(/植物奶|燕麥奶|豆奶/.test(q)&&filters.milk==='fresh')){
    warnings.push('文字要求的奶類與選單不同，請先統一奶類條件。');
    return {filters,warnings,blocked:true,preferences:[]};
  }
  if (noMilk) {
    if (filters.milk && !['any', 'none'].includes(filters.milk)) { warnings.push('文字要求不含奶，與奶類選項衝突，請調整後再查詢。'); return {filters, warnings, blocked: true, preferences: []}; }
    filters.milk = 'none';
  } else if (/鮮奶/.test(q) && filters.milk === 'none') {
    warnings.push('文字要求鮮奶，與無奶選項衝突，請調整後再查詢。');
    return {filters, warnings, blocked: true, preferences: []};
  } else if (/鮮奶/.test(q) && (!filters.milk || filters.milk === 'any')) filters.milk = 'fresh';
  else if (/植物奶|燕麥奶|豆奶/.test(q) && (!filters.milk || filters.milk === 'any')) filters.milk = 'plant';
  const mentionedBrands = brands.filter(b => q.includes(b)&&!filters.excludedBrands?.includes(b));
  if (!filters.brand && mentionedBrands.length === 1 && !new RegExp(`(?:不要|排除|不喝)${mentionedBrands[0]}`).test(q)) filters.brand = mentionedBrands[0];
  if(filters.brand&&filters.excludedBrands?.includes(filters.brand)){
    warnings.push(`「${filters.brand}」同時被指定與排除，請調整品牌設定後再推薦。`);
    return {filters,warnings,blocked:true,preferences:[]};
  }
  if (/^未辨識條件：/.test(q)||(/^忌口：/.test(q)&&!/過敏|花生|堅果|乳糖不耐|麩質/.test(q.slice(3)))) {
    warnings.push('我還沒理解要排除的項目。請補充完整名稱，例如「不要珍珠」，或按下方「重新開始」換個需求。');
    return {filters,warnings,blocked:true,preferences:[]};
  }
  if (/過敏|花生|堅果|乳糖不耐|麩質|忌口/.test(q)) {
    warnings.push('目前過敏原欄位尚未核對，無法提供符合過敏或忌口限制的推薦。請先向店家確認成分。');
    return {filters, warnings, blocked: true, preferences: []};
  }
  if (/無糖|不加糖|不要糖|半糖|微糖|少糖|去冰|溫熱|熱飲/.test(q)) warnings.push('資料缺少可選甜度與冷熱的完整規則，這些條件需向店家確認，未作為已符合的篩選條件。');
  const withoutToppings=stripToppingExclusions(q,t=>{filters.excludedToppings=[...new Set([...(filters.excludedToppings??[]),t])];});
  if (/排除|不喝(?:紅茶|綠茶|青茶|烏龍)/.test(withoutToppings)) {
    warnings.push('目前無法完整驗證文字中的排除條件；請改用支援的篩選條件後再查詢。');
    return {filters, warnings, blocked: true, preferences: []};
  }
  if(/奶茶/.test(q))filters.milkTea=true;
  if(filters.milkTea&&filters.milk==='none'){
    warnings.push('奶茶需求與無奶條件衝突，請先統一條件。');return {filters,warnings,blocked:true,preferences:[]};
  }
  const requestedToppings = toppingTerms.filter(t => withoutToppings.includes(t)&&!filters.excludedToppings?.some(x=>sameTopping(x,t)));
  if (!filters.topping && requestedToppings.length === 1) filters.topping = requestedToppings[0];
  if(filters.topping&&filters.excludedToppings?.includes(filters.topping)){
    warnings.push('同一配料同時被指定與排除，請調整條件。');return {filters,warnings,blocked:true,preferences:[]};
  }
  const requestedTea = ['紅茶', '綠茶', '青茶', '烏龍茶', '金萱茶', '普洱茶', '蕎麥茶'].filter(t => q.includes(t));
  if (!filters.tea && requestedTea.length === 1) filters.tea = requestedTea[0];
  const preferences = ['清爽', '回甘', '果香', '酸甜', '濃郁', '奶香', '嚼勁', '提神', '茶香', '花香'].filter(p => q.includes(p));
  return {filters, warnings, blocked: false, preferences};
}
