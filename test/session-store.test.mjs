import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { mergeResponseCookies, replaceSession, persistSessionRotation } from '../src/session-store.mjs';
import { NswttTransport } from '../src/nswtt-transport.mjs';

test('merge preserves unrelated cookies and handles expiry and max-age precedence',()=>{
 const s={headers:{cookie:'sid=old; other=keep'}};
 const n=mergeResponseCookies(s,['sid=new; Path=/; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],1000);
 assert.equal(n.headers.cookie,'sid=new; other=keep');assert.equal(n.cookieExpiries.sid,61000);
 assert.equal(mergeResponseCookies(n,[],62000).headers.cookie,'other=keep');
 assert.equal(mergeResponseCookies(n,['sid=; Path=/; Max-Age=0'],2000).headers.cookie,'other=keep');
 assert.equal(s.headers.cookie,'sid=old; other=keep');
});
test('foreign domains and narrow paths cannot alter the API session',()=>{
 const s={headers:{cookie:'sid=old'}};
 assert.equal(mergeResponseCookies(s,['sid=bad; Path=/; Domain=evil.example','sid=bad; Path=/unrelated']),s);
 assert.equal(mergeResponseCookies(s,['sid=good; Path=/; Domain=.rim20.com']).headers.cookie,'sid=good');
});
test('persisted rotation survives reload and stale responses cannot overwrite a new import',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tennis-session-'));const path=join(dir,'session.json');
 try{
  const old={headers:{cookie:'sid=old'}};await replaceSession(path,old);
  const next=mergeResponseCookies(old,['sid=new; Path=/']);await persistSessionRotation(path)(old,next);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),next);
  const imported={headers:{cookie:'sid=imported'}};await replaceSession(path,imported);
  await assert.rejects(persistSessionRotation(path)(old,next),/其他请求更新/);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),imported);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('transport saves rotated response cookies and sends them on the next request',async()=>{
 const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const config={publicKey,headers:{cookie:'sid=old'}};const seen=[];let saves=0;
 const t=new NswttTransport(config,{onSessionUpdate:async(before,after)=>{saves++;assert.equal(before.headers.cookie,'sid=old');assert.equal(after.headers.cookie,'sid=new');},fetchFn:async(url,options)=>{
  seen.push(options.headers.cookie);
  return new Response(JSON.stringify({code:0,data:{ok:true}}),{headers:seen.length===1?{'set-cookie':'sid=new; Path=/; HttpOnly'}:{}});
 }});
 await t.request('wtt/user/wttauth/info',{},'POST');await t.request('wtt/user/wttauth/info',{},'POST');
 assert.deepEqual(seen,['sid=old','sid=new']);assert.equal(saves,1);
});
