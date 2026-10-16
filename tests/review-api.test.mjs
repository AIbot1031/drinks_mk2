import {test} from 'node:test';import assert from 'node:assert/strict';
const base=process.env.REVIEW_TEST_BASE_URL,id=process.env.REVIEW_TEST_ID,password=process.env.REVIEW_TEST_PASSWORD;
test('team review requires authentication, searches original conversation text and clears the cookie on logout',{skip:!base||!id||!password},async()=>{
 assert.equal((await fetch(`${base}/api/internal/traces`)).status,401);
 const login=await fetch(`${base}/api/internal/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,password})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('SameSite=Strict'));
 const headers={Cookie:cookie.split(';')[0]};
 const response=await fetch(`${base}/api/internal/traces?q=${encodeURIComponent('近乎為零')}`,{headers});assert.equal(response.status,200);
 const data=await response.json();assert.ok(data.results.length);assert.ok(data.results.every(r=>r.query.includes('近乎為零')));
 const detail=await fetch(`${base}/api/internal/traces/${data.results[0].id}`,{headers});assert.equal(detail.status,200);
 assert.equal((await detail.json()).conversation.message,'100元內 茶類 咖啡因含量近乎為零');
 assert.equal((await fetch(`${base}/api/internal/traces`,{headers:{...headers,Origin:'https://example.invalid'}})).status,403);
 const chatResponse=await fetch(`${base}/api/chat/recommend`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'100元內 茶類 咖啡因含量近乎為零'})});assert.equal(chatResponse.status,200);const chat=await chatResponse.json();
 const saved=await(await fetch(`${base}/api/internal/traces/${chat.traceId}`,{headers})).json();assert.equal(saved.conversation.assistantMessage,chat.assistantMessage);assert.deepEqual(saved.conversation.choices,chat.choices);assert.deepEqual(saved.consumerOutput.results,chat.results);
 const manualResponse=await fetch(`${base}/api/recommend`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'清爽茶，60元內'})});assert.equal(manualResponse.status,200);const manual=await manualResponse.json();const savedManual=await(await fetch(`${base}/api/internal/traces/${manual.traceId}`,{headers})).json();assert.equal(savedManual.request.query,'清爽茶，60元內');
 const logout=await fetch(`${base}/api/internal/logout`,{method:'POST',headers});assert.equal(logout.status,200);assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
});
