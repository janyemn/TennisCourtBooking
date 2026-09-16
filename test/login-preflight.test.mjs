import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoginPreflight} from '../src/login-preflight.mjs';
test('checks at twenty minutes, once per occurrence, and opens sync for expired login',async()=>{
  let now=0,checks=0,opens=0;
  const job={id:'one',status:'scheduled',identity:'市民',runAt:new Date(21*60000).toISOString()};
  const tick=createLoginPreflight({now:()=>now,check:async()=>{checks++;return {status:'expired',checkedAt:'now'};},openSync:async()=>{opens++;return 'sync opened';},save:async()=>{}});
  await tick([job]);assert.equal(checks,0);
  now=60000;await tick([job]);await tick([job]);assert.equal(checks,1);assert.equal(opens,1);
  assert.match(job.message,/sync opened/);
  job.runAt=new Date(now+19*60000).toISOString();await tick([job]);assert.equal(checks,2);
});
test('valid login also opens sync; immediate and executing jobs are skipped',async()=>{
  let opens=0,checks=0;
  const tick=createLoginPreflight({now:()=>0,check:async()=>{checks++;return {status:'valid'};},openSync:async()=>{opens++;},save:async()=>{}});
  const job={id:'a',status:'scheduled',runAt:new Date(60000).toISOString()};
  await tick([job,{...job,id:'b',timing:{immediate:true}},{...job,id:'c',status:'running'},{...job,id:'d',runAt:new Date(10000).toISOString()}]);
  assert.equal(checks,1);assert.equal(opens,1);assert.equal(job.loginPreparation.status,'valid');
});
test('network error is distinct from expired and sync failure is visible',async()=>{
  const job={id:'a',status:'scheduled',runAt:new Date(60000).toISOString()};
  const tick=createLoginPreflight({now:()=>0,check:async()=>({status:'expired'}),openSync:async()=>{throw Error('busy');},save:async()=>{}});
  await tick([job]);assert.match(job.message,/busy/);
});
