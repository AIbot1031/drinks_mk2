import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('public recommendation UI has no store selection, supply display or reporting controls',async()=>{
 const [html,app,region]=await Promise.all(['public/index.html','public/app.js','public/region-controls.js'].map(f=>readFile(f,'utf8')));
 assert.doesNotMatch(html,/store-select|store-query|store-panel|store-research|store-reports|手動填入|想去哪家門市|本次缺品/);
 assert.doesNotMatch(app,/storeController|store-controls|data-store-report|stores\/reports/);
 assert.doesNotMatch(region,/storeController|store-panel|stores\/reports/);
 assert.match(html,/一般推薦（不看地區）/);assert.match(html,/依地區推薦（硬限制）/);
});
