import assert from 'node:assert/strict';
import {test} from 'node:test';
import {toggleProductPreference,likedProducts,dislikedProducts,productKey} from '../public/preferences.js';
const small={id:'small',brand:'品牌A',name:'紅茶',tea:['紅茶'],milk:[],toppings:[]};
const large={...small,id:'large'},other={...small,id:'other',brand:'品牌B'};
const empty=()=>({version:2,liked:{},disliked:[],dislikedProducts:{}});
test('a dislike persists through reload and can be removed from a different cup size',()=>{
 const original=empty(),saved=toggleProductPreference(original,small,'dislike');
 const restored=JSON.parse(JSON.stringify(saved));
 assert.ok(dislikedProducts(restored).has(productKey(large)));
 assert.deepEqual(toggleProductPreference(restored,large,'dislike').disliked,[]);
 assert.deepEqual(original,empty());
});
test('switching like/dislike across cup sizes replaces the entire product preference',()=>{
 const disliked=toggleProductPreference(empty(),small,'dislike');
 const liked=toggleProductPreference(disliked,large,'like');
 assert.equal(likedProducts(liked).size,1);assert.deepEqual(liked.disliked,[]);
 assert.deepEqual(liked.dislikedProducts,{});
 const switched=toggleProductPreference(liked,small,'dislike');
 assert.equal(likedProducts(switched).size,0);assert.equal(dislikedProducts(switched).size,1);
 assert.deepEqual(toggleProductPreference(toggleProductPreference(empty(),small,'like'),large,'like').liked,{});
});
test('equal drink names in different brands keep independent preferences',()=>{
 const a=toggleProductPreference(empty(),small,'dislike');
 const b=toggleProductPreference(a,other,'like');
 assert.ok(dislikedProducts(b).has(productKey(large)));assert.ok(likedProducts(b).has(productKey(other)));
 assert.deepEqual(b.disliked,['small']);
});
