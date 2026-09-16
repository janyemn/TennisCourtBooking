import test from 'node:test';
import assert from 'node:assert/strict';
import {newPairing,syncCandidate} from '../src/session-sync.mjs';
const base={appid:'wx-test',headers:{cookie:'sid=old'},cookieExpiries:{sid:0},cookieUpdatedAt:'old'};
const input={origin:'https://nswtt.rim20.com',path:'/api/wtt/user/wttauth/info',headers:{cookie:'sid=new',referer:'https://servicewechat.com/wx-test/1/page-frame.html',authorization:'unrelated'}};
test('only locally paired target headers are accepted; stale expiry is not inherited',()=>{
 const p=newPairing('市民',1000),c=syncCandidate(base,p,input,p.token,2000);
 assert.equal(c.headers.cookie,'sid=new');assert.equal(c.headers.authorization,undefined);assert.equal(c.cookieExpiries,undefined);assert.equal(base.headers.cookie,'sid=old');
});
test('expired, foreign, unpaired or invalid input is rejected',()=>{
 const p=newPairing('市民',1000);
 for(const [v,t,n] of [[input,'x',2000],[input,p.token,9999999],[{...input,origin:'https://other.example'},p.token,2000],[{...input,path:'/api/wtt/sport/order/add'},p.token,2000],[{...input,headers:{...input.headers,referer:'https://evil.example'}},p.token,2000]])assert.throws(()=>syncCandidate(base,p,v,t,n));
 assert.throws(()=>newPairing('师生'));
});
