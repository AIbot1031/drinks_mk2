import directory from 'drinks-directory';
import {isMenuDrink,type Drink} from './types';
export type RegionScope={city:string;district:string;brands:Set<string>};
export const regionDirectory=()=>({regions:directory.regions,checkedAt:directory.checkedAt,coverage:'地區來自公開門市地址；榜單僅含本網站已有飲料資料的品牌。無符合資料時不自動跨區；不是全台完整門市清單。'});
export function readRegion(value:unknown):RegionScope|undefined{
 if(value===null||value===undefined)return;
 if(typeof value!=='object'||Array.isArray(value))throw Error('請選擇有效的縣市及鄉鎮市區。');
 const {city}=value as Record<string,unknown>,district=(value as Record<string,unknown>).district??'';
 if(typeof city!=='string'||typeof district!=='string'||!directory.regions.some(r=>r.city===city&&(!district||r.district===district)))throw Error('請選擇已收錄的縣市；鄉鎮市區可略過。');
 return {city,district,brands:new Set(directory.stores.filter(s=>s.city===city&&(!district||s.district===district)).map(s=>s.brand))};
}
const normal=(s:string)=>s.normalize('NFKC').replaceAll('臺','台').replace(/\s/g,'');
const north=['台北市','新北市','基隆市','桃園市','新竹市','新竹縣','宜蘭縣'];
const central=['苗栗縣','台中市','彰化縣','南投縣','雲林縣'];
const south=['嘉義市','嘉義縣','台南市','高雄市','屏東縣'];
const allCities=[...new Set(directory.regions.map(r=>normal(r.city)))];
/** Original numeric facts belong to their stated applicability, never to every
 * branch of the brand. Ambiguous or branch-specific scopes fail closed. */
export function originalRegionEligible(d:Drink,scope:RegionScope){
 const text=normal(d.region??''),city=normal(scope.city);
 // A branch/menu-format restriction cannot be widened to a whole county.
 if(/\([^)]*(?:店|門市)|代表門市|測試店|微型店|商場|百貨|專櫃|限定供應/.test(text))return false;
 const cities=new Set<string>();
 for(const name of allCities)if(text.includes(name.replace(/[縣市]$/,'')))cities.add(name);
 if(/北部|北區/.test(text))north.forEach(c=>cities.add(c));
 if(/中部|中區/.test(text))central.forEach(c=>cities.add(c));
 if(/南部|南區/.test(text))south.forEach(c=>cities.add(c));
 if(/中南部|中\/南部|中、南部/.test(text))[...central,...south].forEach(c=>cities.add(c));
 if(/北北基桃竹/.test(text))north.filter(c=>c!=='宜蘭縣').forEach(c=>cities.add(c));
 if(/桃竹苗/.test(text))['桃園市','新竹市','新竹縣','苗栗縣'].forEach(c=>cities.add(c));
 if(/高屏/.test(text))['高雄市','屏東縣'].forEach(c=>cities.add(c));
 if(/彰投/.test(text))['彰化縣','南投縣'].forEach(c=>cities.add(c));
 if(cities.size)return cities.has(city);
 return /全台|全國|台灣一般門市|台灣門市|官網台灣菜單|官網台灣飲品/.test(text);
}
export const regionEligible=(d:Drink,region?:RegionScope)=>!region||(region.brands.has(d.brand)&&(isMenuDrink(d)
 ?!!d.regionKeys?.some(key=>key===region.city+'|'+region.district||!region.district&&key.startsWith(region.city+'|'))
 :originalRegionEligible(d,region)));
export function regionalDrink(d:Drink,scope?:RegionScope):Drink{
 if(!scope||!isMenuDrink(d))return d;
 const ids=new Set(d.sourceStoreIds);
 const source=directory.stores.find(s=>s.brand===d.brand&&s.city===scope.city&&(!scope.district||s.district===scope.district)&&(ids.has(s.id)||ids.has((s.menuSourceUrl||s.sourceUrl).split('/').at(-1)??'')));
 // Never send the first national sample's branch link as the local source.
 return {...d,region:scope.city+scope.district,sourceUrl:source?.menuSourceUrl||undefined,sourceCheckedAt:source?.checkedAt};
}
export function assertStoreRegion(store:{brand:string;name:string;address:string}|undefined,region?:RegionScope){
 if(!store||!region)return;
 if(!directory.stores.some(s=>s.city===region.city&&(!region.district||s.district===region.district)&&s.brand===store.brand&&s.name===store.name&&s.address===store.address))throw Error('所選門市不在指定地區，請重新選擇門市。');
}
export const regionStores=(city:string,district='')=>directory.stores.filter(s=>s.city===city&&(!district||s.district===district));
