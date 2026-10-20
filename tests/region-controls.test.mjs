import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scopeBody} from '../public/region-controls.js';
test('general mode explicitly clears old store, region and reports; region requires both selectors',()=>{
 assert.deepEqual(scopeBody('general','雲林縣','虎尾鎮'),{searchMode:'general',region:null,store:null,storeReports:[]});
 assert.throws(()=>scopeBody('region','雲林縣',''));
 assert.deepEqual(scopeBody('region','雲林縣','虎尾鎮'),{searchMode:'region',region:{city:'雲林縣',district:'虎尾鎮'},store:null,storeReports:[]});
});
