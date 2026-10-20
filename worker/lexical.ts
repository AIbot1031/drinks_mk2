import {isMenuDrink} from './types';
import type {Drink} from './types';
export const concepts: Record<string, string[]> = {
  清爽: ['清爽', '淡雅', '清香', '清新', '輕盈'], 濃郁: ['濃郁', '香濃', '厚重', '濃厚'],
  果香: ['果香', '水果', '柚', '檸檬', '芒果', '蜜桃', '荔枝', '葡萄', '柳橙', '百香'],
  酸甜: ['酸甜', '酸香', '檸檬', '柚', '百香', '莓'], 奶香: ['奶香', '鮮奶', '拿鐵', '奶茶', '乳'],
  嚼勁: ['嚼勁', '珍珠', '波霸', '椰果', '布丁', '粉粿', '燕麥'], 回甘: ['回甘', '茶香', '烏龍', '青茶'],
  花香: ['花香', '茉莉', '桂花', '玫瑰'], 提神: ['提神', '咖啡', '紅茶', '抹茶'],
};
export function searchable(d: Drink): string { return isMenuDrink(d)?`${d.name} ${d.brand} ${d.sourceMenuCategory||''}`:`${d.name} ${d.brand} ${d.taste} ${d.category} ${d.tea.join(' ')} ${d.milk.join(' ')} ${d.toppings.join(' ')}`; }
export function tokenize(text: string): string[] {
  const s = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) tokens.add(s.slice(i, i + 2));
  for (const [key, terms] of Object.entries(concepts)) if (terms.some(t => text.includes(t))) tokens.add(`concept:${key}`);
  return [...tokens];
}
export type LexicalIndex={terms:string[];frequency:number[];vectors:number[][];norms:number[]};
/** Deterministic public-text search index, not neural model weights/training. */
export function prepareLexicalIndex(drinks:Drink[]):LexicalIndex{
 const dictionary=new Map<string,number>(),frequency:number[]=[];
 const vectors=drinks.map(d=>tokenize(searchable(d)).map(token=>{
  let id=dictionary.get(token);if(id===undefined){id=frequency.length;dictionary.set(token,id);frequency.push(0);}frequency[id]++;return id;
 }));
 const weights=frequency.map(count=>(1+Math.log((1+drinks.length)/(1+count)))**2);
 const norms=vectors.map(vector=>Math.sqrt(vector.reduce((sum,id)=>sum+weights[id],0)));
 for(const vector of vectors)vector.sort((a,b)=>a-b);
 return {terms:[...dictionary.keys()],frequency,vectors,norms};
}
