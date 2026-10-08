import type { Filters, RecommendInput, Understanding } from './types';

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
  const milk = str('milk');
  if (milk && !['any', 'none', 'fresh', 'plant'].includes(milk)) throw new Error('奶類選項無效');
  const ids = (key: string, max = 200): string[] => {
    const values = v[key] ?? [];
    if (!Array.isArray(values) || values.length > max || values.some(id => typeof id !== 'string' || id.length > 80)) throw new Error('回饋資料格式有誤');
    return [...new Set(values)] as string[];
  };
  const limit = v.limit ?? 6;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('推薦數量須介於 1 至 20');
  return {query: v.query.trim(), filters: {brand: str('brand'), maxPrice: bounded(f.maxPrice, '預算', 10000), maxCalories: bounded(f.maxCalories, '熱量', 10000), maxCaffeine: bounded(f.maxCaffeine, '咖啡因', 10000), milk: milk as Filters['milk'], tea: str('tea'), topping: str('topping')}, likedIds: ids('likedIds'), dislikedIds: ids('dislikedIds'), excludedIds: ids('excludedIds', 2000), limit};
}

export function understand(input: RecommendInput, brands: string[]): Understanding {
  const q = input.query;
  const filters = {...input.filters};
  const warnings: string[] = [];
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
  const noMilk = /(?:不要|不含|不加|不能喝|不喝|無)[^，。\s]{0,3}(?:奶|乳)/.test(q);
  if (noMilk) {
    if (filters.milk && !['any', 'none'].includes(filters.milk)) { warnings.push('文字要求不含奶，與奶類選項衝突，請調整後再查詢。'); return {filters, warnings, blocked: true, preferences: []}; }
    filters.milk = 'none';
  } else if (/鮮奶/.test(q) && filters.milk === 'none') {
    warnings.push('文字要求鮮奶，與無奶選項衝突，請調整後再查詢。');
    return {filters, warnings, blocked: true, preferences: []};
  } else if (/鮮奶/.test(q) && (!filters.milk || filters.milk === 'any')) filters.milk = 'fresh';
  else if (/植物奶|燕麥奶|豆奶/.test(q) && (!filters.milk || filters.milk === 'any')) filters.milk = 'plant';
  const mentionedBrands = brands.filter(b => q.includes(b));
  if (!filters.brand && mentionedBrands.length === 1 && !new RegExp(`(?:不要|排除|不喝)${mentionedBrands[0]}`).test(q)) filters.brand = mentionedBrands[0];
  if (/過敏|花生|堅果|乳糖不耐|麩質|忌口/.test(q)) {
    warnings.push('目前過敏原欄位尚未核對，無法提供符合過敏或忌口限制的推薦。請先向店家確認成分。');
    return {filters, warnings, blocked: true, preferences: []};
  }
  if (/無糖|不加糖|不要糖|半糖|微糖|少糖|去冰|溫熱|熱飲/.test(q)) warnings.push('資料缺少可選甜度與冷熱的完整規則，這些條件需向店家確認，未作為已符合的篩選條件。');
  if (/不要(?:珍珠|椰果|布丁|仙草)|排除|不喝(?:紅茶|綠茶|青茶|烏龍)/.test(q)) {
    warnings.push('目前無法完整驗證文字中的排除條件；請改用支援的篩選條件後再查詢。');
    return {filters, warnings, blocked: true, preferences: []};
  }
  const requestedToppings = ['珍珠', '椰果', '布丁', '仙草', '燕麥', '粉粿'].filter(t => q.includes(t));
  if (!filters.topping && requestedToppings.length === 1) filters.topping = requestedToppings[0];
  const requestedTea = ['紅茶', '綠茶', '青茶', '烏龍茶', '金萱茶', '普洱茶', '蕎麥茶'].filter(t => q.includes(t));
  if (!filters.tea && requestedTea.length === 1) filters.tea = requestedTea[0];
  const preferences = ['清爽', '回甘', '果香', '酸甜', '濃郁', '奶香', '嚼勁', '提神', '茶香', '花香'].filter(p => q.includes(p));
  return {filters, warnings, blocked: false, preferences};
}
