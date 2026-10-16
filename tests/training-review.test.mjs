import {test} from 'node:test';import assert from 'node:assert/strict';import {metricOutcome} from '../public/training-review.js';
test('training dashboard distinguishes metric direction, missing posttest and unchanged values',()=>{
 assert.equal(metricOutcome({before:.9,after:.5,delta:-.4,direction:'higher'}),'數值退步');
 assert.equal(metricOutcome({before:.9,after:.5,delta:-.4,direction:'lower'}),'數值改善');
 assert.equal(metricOutcome({before:.9,after:null,delta:null,direction:'higher'}),'未完成比較');
 assert.equal(metricOutcome({before:1,after:1,delta:0,direction:'higher'}),'持平');
});
