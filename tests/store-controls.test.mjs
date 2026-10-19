import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activeReports} from '../public/store-controls.js';
test('browser session reports expire with server rules and corrupted stored lists are harmless',()=>{
 const at=Date.parse('2026-10-20T23:59:00+08:00'),sold={kind:'sold_out',reportedAt:at};
 assert.equal(activeReports([sold],at).length,1);assert.equal(activeReports([sold],at+60000).length,0);
 assert.equal(activeReports([{...sold,kind:'not_sold'}],at+7*86400000).length,0);
 assert.deepEqual(activeReports({}),[]);assert.deepEqual(activeReports([null,{kind:'sold_out',reportedAt:NaN}]),[]);
});
