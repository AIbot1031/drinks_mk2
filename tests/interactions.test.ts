import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {preferenceChangeStatements} from '../worker/interactions';

test('interaction history preserves changes, ignores retries, and commits atomically',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0002_consumer_accounts.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_consumer_interactions.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO consumer_users(id,password_hash,salt,iterations,created_at) VALUES (?,?,?,?,?)').run('testauthhistory','test','test',1,0);
  function save(liked:string[],disliked:string[],requestId:string,at:number){
    db.exec('BEGIN');
    try{
      for(const s of preferenceChangeStatements('testauthhistory',liked,disliked,requestId,at))db.prepare(s.sql).run(...s.params);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const events=()=>db.prepare('SELECT drink_id,action,occurred_at FROM consumer_interactions ORDER BY occurred_at,action').all().map(r=>({...r}));
  save(['a'],['b'],'first',100);
  assert.deepEqual(events(),[{drink_id:'b',action:'dislike',occurred_at:100},{drink_id:'a',action:'like',occurred_at:100}]);
  save(['a'],['b'],'retry',200);
  assert.equal(events().length,2);
  save(['b'],[],'switch',300);
  assert.deepEqual(events().slice(2),[{drink_id:'b',action:'like',occurred_at:300},{drink_id:'b',action:'undislike',occurred_at:300},{drink_id:'a',action:'unlike',occurred_at:300}]);
  save([],['b'],'fourth',400);
  const before=events();
  // Reusing an event ID forces an INSERT failure; no partial snapshot update.
  assert.throws(()=>save(['b'],[],'switch',500));
  assert.deepEqual(events(),before);
  assert.equal(db.prepare('SELECT preferences FROM consumer_users').get()!.preferences,JSON.stringify({likedIds:[],dislikedIds:['b']}));
  db.close();
});
