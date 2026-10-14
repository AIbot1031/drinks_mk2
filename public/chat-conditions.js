import {selectedToppings} from './topping-selection.js';
export function conditionLabels(snapshot) {
  const filters=snapshot.filters??{},pending=new Set((snapshot.pendingCaps??[]).map(q=>q.field));
  const labels={excludedToppings:v=>v.length?`不加：${v.join('、')}`:'',milkTea:v=>v===false?'不喝奶茶':v?'奶茶':'',maxPrice:v=>`預算 ${filters.priceExclusive?'<':'≤'} ${v} 元`,maxCalories:v=>`熱量 ${filters.caloriesExclusive?'<':'≤'} ${v} kcal`,maxCaffeine:v=>`咖啡因 ${filters.caffeineExclusive?'<':'≤'} ${v} mg`,brand:v=>v,excludedBrands:v=>v.length?`不要：${v.join('、')}`:'',milk:v=>({none:'無奶標記',fresh:'鮮奶',plant:'植物奶',any:'奶類不限'})[v],tea:v=>v,topping:v=>v};
  const values=Object.entries(filters).filter(([k,v])=>v!==undefined&&!pending.has(k)).map(([k,v])=>labels[k]?.(v)).filter(Boolean);
  if(filters.toppings?.length)values.push(`含：${selectedToppings(filters).join('、')}`);
  if(snapshot.query)values.unshift(`口味：${snapshot.query}`);
  if(filters.maxCaffeine===undefined&&!pending.has('maxCaffeine'))values.push('咖啡因上限：未設定');
  if(pending.size)values.push(`待確認：${[...pending].map(f=>({maxPrice:'預算',maxCalories:'熱量',maxCaffeine:'咖啡因'})[f]).join('、')}`);
  if(snapshot.guard)values.push('有待釐清的限制');
  return values;
}
