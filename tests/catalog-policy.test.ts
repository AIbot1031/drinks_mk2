import assert from 'node:assert/strict';import {test} from 'node:test';
import catalog from '../data/catalog.json';import directory from '../data/nidin-directory.json';
import {isCatalogBeverage} from '../worker/catalog-policy';
import {eligible,makeEngine} from '../worker/recommend';import {readRegion,regionEligible} from '../worker/regions';import {validateInput} from '../worker/understand';
test('every catalog row is a beverage and runtime rejects injected informational or merchandise cards',()=>{
 assert.equal(new Set(catalog.drinks.map(d=>d.brand)).size,41);
 for(const d of catalog.drinks)assert.ok(isCatalogBeverage(d),d.brand+' '+d.name);
 for(const name of ['飲品產地資訊一覽','請勿下單','新品娃娃','【１＋１】奶茶+娃娃','塑膠袋'])assert.equal(eligible({...catalog.drinks[0],name},{}),false);
 assert.equal(isCatalogBeverage({name:'珍珠奶茶',sourceMenuCategory:'限定優惠 ♥'}),true);
});
test('Huwei CoCo excludes stopped 3Q without requiring a topping filter and cannot leak through model or preference ranking',()=>{
 const region=readRegion({city:'雲林縣',district:'虎尾鎮'})!,engine=makeEngine(catalog.drinks);
 const input={...validateInput({query:'3Q奶茶',filters:{brand:'CoCo都可'}}),region};
 const pool=engine.candidatePool(input);assert.ok(pool.length);
 assert.ok(pool.every(d=>!/^3q/i.test(d.name)));
 for(const s of directory.stores.filter(s=>s.brand==='CoCo都可'&&s.city==='雲林縣'&&s.district==='虎尾鎮'))assert.ok(!s.menuNames?.some(n=>/^3q/i.test(n)));
 const foreign=catalog.drinks.filter(d=>d.brand==='CoCo都可'&&/^3q/i.test(d.name));
 assert.ok(foreign.every(d=>!regionEligible(d,region)));
 const result=engine.recommendWithTrace(input,{scores:foreign.map(d=>({id:d.id,score:999})),modelVersion:'test',durationMs:0},undefined,true).response;
 assert.ok(result.results.every(r=>!/^3q/i.test(r.drink.name)));
 const seed=pool[0];assert.equal(regionEligible({...seed,name:'本地公開菜單沒有這杯',sourceKind:undefined,region:'中南部'},region),false);
});
