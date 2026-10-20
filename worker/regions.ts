import directory from '../data/nidin-directory.json';
import type {Drink} from './types';
export type RegionScope={city:string;district:string;brands:Set<string>};
export const regionDirectory=()=>({regions:directory.regions,checkedAt:directory.checkedAt,coverage:'地區來自公開門市地址；榜單僅含本網站已有飲料資料的品牌。無符合資料時不自動跨區；不是全台完整門市清單。'});
export function readRegion(value:unknown):RegionScope|undefined{
 if(value===null||value===undefined)return;
 if(typeof value!=='object'||Array.isArray(value))throw Error('請選擇有效的縣市及鄉鎮市區。');
 const {city}=value as Record<string,unknown>,district=(value as Record<string,unknown>).district??'';
 if(typeof city!=='string'||typeof district!=='string'||!directory.regions.some(r=>r.city===city&&(!district||r.district===district)))throw Error('請選擇已收錄的縣市；鄉鎮市區可略過。');
 return {city,district,brands:new Set(directory.stores.filter(s=>s.city===city&&(!district||s.district===district)).map(s=>s.brand))};
}
export const regionEligible=(d:Drink,region?:RegionScope)=>!region||(region.brands.has(d.brand)&&(d.sourceKind!=='nidin'||!!d.regionKeys?.some(key=>key===region.city+'|'+region.district||!region.district&&key.startsWith(region.city+'|'))));
export function assertStoreRegion(store:{brand:string;name:string;address:string}|undefined,region?:RegionScope){
 if(!store||!region)return;
 if(!directory.stores.some(s=>s.city===region.city&&(!region.district||s.district===region.district)&&s.brand===store.brand&&s.name===store.name&&s.address===store.address))throw Error('所選門市不在指定地區，請重新選擇門市。');
}
export const regionStores=(city:string,district='')=>directory.stores.filter(s=>s.city===city&&(!district||s.district===district));
