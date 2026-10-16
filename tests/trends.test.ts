import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nextWeeklyUpdate,newsRows,communityRows,rankRows} from '../worker/trends';
import catalog from '../data/catalog.json';
const start=Date.parse('2026-10-05T18:00:00Z'),end=Date.parse('2026-10-12T18:00:00Z');
const article=(title:string,url:string,seendate='20261010T120000Z')=>({title,url,seendate});
test('weekly refresh is Monday 02:00 Taipei and advances at trigger time',()=>{
 assert.equal(nextWeeklyUpdate(Date.parse('2026-10-11T17:59:00Z')),'2026-10-11T18:00:00.000Z');
 assert.equal(nextWeeklyUpdate(Date.parse('2026-10-11T18:00:00Z')),'2026-10-18T18:00:00.000Z');
 assert.equal(nextWeeklyUpdate(Date.parse('2026-10-12T12:00:00Z')),'2026-10-18T18:00:00.000Z');
});
test('news counts only actual headline mentions, de-duplicates URLs and syndicated identical headlines',()=>{
 const value={articles:[article('春水堂推出新飲品','https://example.com/1?utm_source=a'),article('春水堂推出新飲品','https://other.example/2'),article('春水堂其他報導','https://example.com/1?utm_source=b'),article('春水堂與迷客夏活動','https://example.com/3'),article('全台手搖飲報導','https://example.com/4')]};
 const result=newsRows(value,['春水堂','迷客夏','五桐號'],start,end);
 assert.equal(result.sampleCount,3);assert.equal(result.rows.find(r=>r.name==='春水堂')!.count,2);assert.equal(result.rows.find(r=>r.name==='迷客夏')!.count,1);assert.equal(result.rows.find(r=>r.name==='五桐號'),undefined);
 assert.equal(result.rows[0].sources[0].url,'https://example.com/1');assert.ok(!JSON.stringify(result).includes('推出新飲品'));
});
test('unusable news links, dates and malformed sources cannot create a ranking',()=>{
 const r=newsRows({articles:[article('春水堂','javascript:alert(1)'),article('春水堂','https://user:pass@example.com/1'),article('春水堂','https://example.com/1','20261001T000000Z'),article('春水堂','https://example.com/2','invalid')]},['春水堂'],start,end);assert.equal(r.rows.length,0);assert.equal(r.sampleCount,0);
 assert.throws(()=>newsRows('rate limited',['春水堂'],start,end));assert.throws(()=>newsRows({},[],start,end));
 assert.equal(newsRows({articles:Array.from({length:250},()=>article('春水堂','https://example.com/1'))},['春水堂'],start,end).truncated,true);
});
test('community votes combine sizes, latest action wins and no user identifiers escape',()=>{
 const a=catalog.drinks.find(d=>catalog.drinks.some(x=>x.id!==d.id&&x.brand===d.brand&&x.name===d.name))!;
 const b=catalog.drinks.find(d=>d.id!==a.id&&d.brand===a.brand&&d.name===a.name)!;
 const event=(id:string,user_id:string,drink_id:string,action:string,offset:number)=>({id,user_id,drink_id,action,occurred_at:start+offset});
 const r=communityRows([event('1','private-A',a.id,'like',1),event('2','private-A',b.id,'like',2),event('3','private-B',b.id,'like',3),event('4','private-B',a.id,'dislike',4),event('5','private-C',a.id,'like',5),event('6','private-C',b.id,'unlike',6),event('7','private-D','missing','like',7),event('8','private-E',a.id,'like',-1)],catalog.drinks,start,end);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].count,1);assert.equal(r.participants,3);assert.equal(r.sampleCount,1);assert.ok(!JSON.stringify(r).includes('private-'));
});
test('equal counts share rank, missing previous data stays unknown',()=>{
 const rows=['a','b','c'].map((key,i)=>({key,name:key,count:i===2?1:3,sources:[]}));const r=rankRows(rows,null);assert.deepEqual(r.map(x=>x.rank),[1,1,3]);assert.ok(r.every(x=>x.previousRank===null));
});
