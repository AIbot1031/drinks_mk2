import type {Drink} from './types';
import {productKey} from './products';
import huwei from '../data/coco-huwei-store.json';
import research from '../data/huwei-brand-research.json';
import directory from 'drinks-directory';
export type Store={id:string;brand:string;name:string;address:string;verified:number;source_url:string;checked_at:number;phone?:string;menu_note?:string;menu_source_url?:string};
export type SupplyStatus={status:'unknown'|'available'|'sold_out'|'not_sold';checkedAt:number|null;expiresAt:number|null;sourceUrl:string;evidence:string;menuListed?:boolean};
export type StoreSupply={store:Store;statuses:Map<string,SupplyStatus>;excluded:Set<string>};
export const sourceUrl='https://shopping.hccg.gov.tw/brands/coco';
type DirectorySeed={brand:string;name:string;address:string;sourceUrl:string;checkedAt:string;phone?:string;menuNote?:string;menuScope?:string;menuSourceUrl?:string;menuNames?:string[];soldOutNames?:string[];unconfirmedNames?:string[];unconfirmedReason?:string;id?:string};
const seeds:DirectorySeed[]=[
 {brand:'CoCo都可',name:'新竹中正店',address:'新竹市北區中正路276號',sourceUrl,checkedAt:'2026-10-20T00:00:00+08:00'},
 {brand:'CoCo都可',name:'新竹清大店',address:'新竹市東區建功路16號',sourceUrl,checkedAt:'2026-10-20T00:00:00+08:00'},
 {...huwei,menuScope:'branch',menuSourceUrl:huwei.sourceUrl,menuNote:`3Q奶茶、3Q鮮奶茶：供應待確認。${huwei.unconfirmedReason}`},
 ...research.stores.map(s=>({...s,...directory.stores.find(d=>d.brand===s.brand&&d.name===s.name&&d.address===s.address)})),
 ...directory.stores.filter(s=>!research.stores.some(r=>r.brand===s.brand&&r.address===s.address)&&!(s.brand===huwei.brand&&s.address===huwei.address)),
];
const seedStore=async(seed:DirectorySeed,brands:string[]):Promise<Store>=>({...(seed.id?{id:seed.id,brand:seed.brand,name:seed.name,address:seed.address}:await storeIdentity(seed,brands)),verified:1,source_url:seed.sourceUrl,checked_at:Date.parse(seed.checkedAt),...(seed.phone?{phone:seed.phone}:{}),...(seed.menuNote?{menu_note:`${seed.menuNote}（查核日期 ${seed.checkedAt.slice(0,10)}；非即時庫存）`}:{}),...(seed.menuSourceUrl?{menu_source_url:seed.menuSourceUrl}:{})});
let cachedSeeds:Promise<Store[]>|undefined;
const seededStores=(brands:string[])=>cachedSeeds??=Promise.all(seeds.map(s=>seedStore(s,brands)));
export const storeResearch=()=>({checkedAt:research.checkedAt,coverage:research.coverage,brands:research.brands});
async function knownStore(db:D1Database,value:unknown,brands:string[]){
 const identity=await storeIdentity(value,brands);
 const registered=await db.prepare('SELECT * FROM drink_stores WHERE id=?').bind(identity.id).first<Store>();
 const all=await seededStores(brands),index=all.findIndex(s=>s.id===identity.id);
 if(index>=0){const metadata=all[index];return {store:registered?.verified?{...metadata,...registered}:metadata,seed:seeds[index]};}
 if(registered?.verified)return {store:registered,seed:undefined};
 throw Error('請從已收錄門市清單選擇門市。');
}
const text=(v:unknown,max:number)=>{
 if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('門市資料格式有誤，請填入品牌、店名及完整地址。');
 return v.normalize('NFKC').trim();
};
export const taipeiDayEnd=(at:number)=>Math.floor((at+8*3600000)/86400000)*86400000+86400000-8*3600000;
export async function storeIdentity(value:unknown,brands:string[]):Promise<Store>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('請從已收錄門市清單選擇門市。');
 const v=value as Record<string,unknown>,brand=text(v.brand,60),name=text(v.name,80),address=text(v.address,160);
 if(!brands.includes(brand)||address.length<6)throw Error('請選擇有效品牌並填入可辨識的完整門市地址。');
 const key=JSON.stringify([brand,name,address].map(s=>s.replace(/\s/g,'').replaceAll('臺','台').toLowerCase()));
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
 const id='s_'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('').slice(0,32);
 return {id,brand,name,address,verified:0,source_url:'',checked_at:0};
}
export async function listedStores(db:D1Database,brands:string[],query:string,region?:{city:string;district:string}){
 const seeded=await seededStores(brands);
 const rows=await db.prepare('SELECT * FROM drink_stores WHERE verified=1 ORDER BY brand,name LIMIT 500').all<Store>();
 const byId=new Map(seeded.map(s=>[s.id,s]));
 for(const row of rows.results)byId.set(row.id,{...byId.get(row.id),...row});
 const list=[...byId.values()];
 const local=region?new Set(directory.stores.filter(s=>s.city===region.city&&(!region.district||s.district===region.district)).map(s=>JSON.stringify([s.brand,s.name,s.address]))):null;
 return list.filter(s=>(!local||local.has(JSON.stringify([s.brand,s.name,s.address])))&&`${s.brand}${s.name}${s.address}`.toLowerCase().includes(query.toLowerCase())).slice(0,50);
}
export function localExclusions(value:unknown,store:Store,drinks:Drink[],now=Date.now()){
 if(value===undefined)return new Set<string>();
 if(!Array.isArray(value)||value.length>200)throw Error('本次門市回報清單格式有誤。');
 const byId=new Map(drinks.map(d=>[d.id,d])),keys=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=='object'||typeof item.drinkId!=='string'||!['sold_out','not_sold'].includes(item.kind)||typeof item.reportedAt!=='number'||!Number.isFinite(item.reportedAt)||item.reportedAt>now+300000)throw Error('本次門市回報格式有誤。');
  if((item.storeId??item.store?.id)!==store.id)continue;
  const d=byId.get(item.drinkId),expiry=item.kind==='sold_out'?taipeiDayEnd(item.reportedAt):item.reportedAt+7*86400000;
  if(d?.brand===store.brand&&item.reportedAt>=0&&now<expiry)keys.add(productKey(d));
 }
 return keys;
}
export async function loadStoreSupply(db:D1Database,value:unknown,reports:unknown,drinks:Drink[],now=Date.now()):Promise<StoreSupply|undefined>{
 if(value===undefined||value===null)return;
 const {store,seed}=await knownStore(db,value,[...new Set(drinks.map(d=>d.brand))]);
 const rows=await db.prepare('SELECT product_key,status,checked_at,expires_at,evidence,source_url FROM store_availability WHERE store_id=? AND expires_at>?').bind(store.id,now).all<{product_key:string;status:SupplyStatus['status'];checked_at:number;expires_at:number;evidence:string;source_url:string}>();
 const statuses=new Map<string,SupplyStatus>();
 // Reviewed static snapshot: no paid API or upstream request on the recommendation path.
 // A menu listing confirms a product, not today's inventory, cup size or custom options.
 if(seed?.menuScope){
  const checkedAt=Date.parse(seed.checkedAt),expiresAt=checkedAt+7*86400000,listed=new Set(seed.menuNames??[]),sold=new Set(seed.soldOutNames??[]);
  for(const d of drinks.filter(d=>d.brand===store.brand)){
   const present=seed.menuScope==='branch'&&listed.has(d.name),fresh=now>=checkedAt&&now<expiresAt;
   const soldOut=present&&sold.has(d.name),saleExpiry=taipeiDayEnd(checkedAt);
   const status:SupplyStatus['status']=soldOut?(fresh&&now<saleExpiry?'sold_out':'unknown'):present&&fresh?'available':'unknown';
   const evidence=soldOut?(status==='sold_out'?'查核時此店官方訂餐頁標示售完；非即時庫存，當日結束後回待確認。':'此品項曾於查核時標示售完，最新供應待重新確認。'):present?(fresh?'此店官方菜單列有此品項；非即時庫存，價格、杯型與客製選項請以門市為準。':'官方菜單查核已超過7天或尚未生效，供應須重新確認。'):seed.unconfirmedNames?.includes(d.name)?seed.unconfirmedReason!:(seed.menuScope==='brand'?'僅有品牌共用菜單，不能證明此店販售；供應待確認。':'此品項未在本次門市菜單查核中確認，實際供應待門市確認。');
   statuses.set(productKey(d),{status,checkedAt,expiresAt:soldOut?saleExpiry:present?expiresAt:null,sourceUrl:seed.menuSourceUrl||seed.sourceUrl,evidence,menuListed:status==='available'});
  }
 }
 // Active human review takes precedence, especially confirmed missing/sold-out items.
 for(const r of rows.results)statuses.set(r.product_key,{status:r.status,checkedAt:r.checked_at,expiresAt:r.expires_at,sourceUrl:r.source_url,evidence:r.evidence});
 const excluded=localExclusions(reports,store,drinks,now);
 for(const [key,s]of statuses)if(s.status==='sold_out'||s.status==='not_sold')excluded.add(key);
 return {store,statuses,excluded};
}
export const storeEligible=(d:Drink,s?:StoreSupply)=>!s||(d.brand===s.store.brand&&!s.excluded.has(productKey(d)));
export const supplyStatus=(d:Drink,s?:StoreSupply):SupplyStatus=>s?.statuses.get(productKey(d))??{status:'unknown',checkedAt:null,expiresAt:null,sourceUrl:'',evidence:''};
export async function submitStoreReport(db:D1Database,body:unknown,drinks:Drink[]){
 if(!body||typeof body!=='object')throw Error('回報格式有誤。');
 const v=body as Record<string,unknown>,{store}=await knownStore(db,v.store,[...new Set(drinks.map(d=>d.brand))]);
 if(typeof v.id!=='string'||! /^[a-f0-9-]{36}$/.test(v.id)||typeof v.reporterId!=='string'||! /^[a-f0-9-]{36}$/.test(v.reporterId)||!['sold_out','not_sold'].includes(v.kind as string))throw Error('請選擇今天售完或菜單沒有。');
 const d=drinks.find(d=>d.id===v.drinkId);if(!d||d.brand!==store.brand)throw Error('此品項不屬於選擇的門市品牌。');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v.reporterId));
 const reporter=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join(''),now=Date.now();
 const old=await db.prepare('SELECT store_id,product_key,kind,created_at,reporter_hash FROM store_reports WHERE id=?').bind(v.id).first<{store_id:string;product_key:string;kind:string;created_at:number;reporter_hash:string}>();
 if(old){if(old.reporter_hash!==reporter||old.store_id!==store.id||old.product_key!==productKey(d)||old.kind!==v.kind)throw Error('回報識別碼不符。');return {id:v.id,storeId:store.id,store,drinkId:d.id,kind:v.kind,reportedAt:old.created_at,pending:true};}
 // Bound anonymous writes without storing IP addresses or account identities.
 await db.prepare('INSERT OR IGNORE INTO drink_stores(id,brand,name,address,verified,source_url,checked_at) SELECT ?,?,?,?,0,\'\',? WHERE (SELECT COUNT(*) FROM store_reports WHERE created_at>?)<200 AND (SELECT COUNT(*) FROM store_reports WHERE reporter_hash=? AND created_at>?)<20').bind(store.id,store.brand,store.name,store.address,now,now-86400000,reporter,now-86400000).run();
 const result=await db.prepare(`INSERT OR IGNORE INTO store_reports(id,store_id,product_key,kind,created_at,reporter_hash)
 SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM drink_stores WHERE id=?) AND (SELECT COUNT(*) FROM store_reports WHERE created_at>?)<200 AND (SELECT COUNT(*) FROM store_reports WHERE reporter_hash=? AND created_at>?)<20`).bind(v.id,store.id,productKey(d),v.kind,now,reporter,store.id,now-86400000,reporter,now-86400000).run();
 if(!result.meta.changes){
  if(await db.prepare('SELECT id FROM store_reports WHERE id=?').bind(v.id).first())return submitStoreReport(db,body,drinks);
  throw Error('最近24小時回報次數已達上限，請稍後再試。');
 }
 return {id:v.id,storeId:store.id,store,drinkId:d.id,kind:v.kind,reportedAt:now,pending:true};
}
export async function reviewStoreReport(db:D1Database,value:unknown){
 const v=value as Record<string,unknown>;if(!v||typeof v.reportId!=='string'||!['available','sold_out','not_sold','reject'].includes(v.status as string))throw Error('查證資料格式有誤。');
 const row=await db.prepare('SELECT * FROM store_reports WHERE id=? AND review_status=\'pending\'').bind(v.reportId).first<{id:string;store_id:string;product_key:string}>();
 if(!row)throw Error('回報不存在或已處理。');
 if(v.status==='reject'){await db.prepare('UPDATE store_reports SET review_status=\'rejected\' WHERE id=?').bind(row.id).run();return;}
 const evidence=text(v.evidence,300),url=v.sourceUrl?text(v.sourceUrl,500):'';
 if(url){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('來源請填公開 HTTPS 網址。');}
 if(v.verifyStore!==undefined&&typeof v.verifyStore!=='boolean')throw Error('門市查證格式有誤。');
 if(v.verifyStore&&!url)throw Error('公開收錄門市前，請填門市資料來源網址。');
 const now=Date.now(),expires=v.status==='sold_out'?taipeiDayEnd(now):now+(v.status==='available'?7:30)*86400000;
 await db.batch([
  db.prepare(`INSERT INTO store_availability(store_id,product_key,status,checked_at,expires_at,evidence,source_url) VALUES(?,?,?,?,?,?,?) ON CONFLICT(store_id,product_key) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,expires_at=excluded.expires_at,evidence=excluded.evidence,source_url=excluded.source_url`).bind(row.store_id,row.product_key,v.status,now,expires,evidence,url),
  db.prepare('UPDATE store_reports SET review_status=\'confirmed\' WHERE id=?').bind(row.id),
  ...(v.verifyStore?[db.prepare('UPDATE drink_stores SET verified=1,source_url=?,checked_at=? WHERE id=?').bind(url,now,row.store_id)]:[]),
 ]);
}
