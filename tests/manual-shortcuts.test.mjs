import assert from 'node:assert/strict';import {test} from 'node:test';
import {validateManualShortcuts,manualDefaults} from '../public/manual-shortcuts.js';
test('manual shortcuts validate bounded labels and text independently of filters or chat commands',()=>{
 assert.equal(manualDefaults.length,4);assert.deepEqual(validateManualShortcuts([{label:' 芋圓 ',message:' 想喝芋圓奶茶 '}]),[{label:'芋圓',message:'想喝芋圓奶茶'}]);
 for(const items of [null,Array(9).fill({label:'a',message:'b'}),[{label:'',message:'茶'}],[{label:'x'.repeat(21),message:'茶'}],[{label:'茶',message:'x'.repeat(301)}]])assert.throws(()=>validateManualShortcuts(items));
 assert.deepEqual(validateManualShortcuts([]),[]);
});
