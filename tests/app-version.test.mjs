import {test} from 'node:test';import assert from 'node:assert/strict';import {versionedLock} from '../scripts/set_app_version.mjs';
test('application version changes never alter dependency versions or download URLs',()=>{
 const dependency={version:'3.1.5',resolved:'https://example.invalid/dependency-3.1.5.tgz',integrity:'original'};
 const lock={version:'3.1.5',packages:{'':{name:'app',version:'3.1.5'},'node_modules/dependency':dependency}};
 const updated=versionedLock(lock,'3.1.6');assert.equal(updated.version,'3.1.6');assert.equal(updated.packages[''].version,'3.1.6');assert.deepEqual(updated.packages['node_modules/dependency'],dependency);assert.equal(lock.version,'3.1.5');
});
