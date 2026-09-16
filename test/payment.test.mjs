import test from 'node:test';
import assert from 'node:assert/strict';
import { NswttAdapter } from '../src/nswtt-adapter.mjs';
const hold={orderId:'order',date:'2026-09-11',courtId:'court',start:'15:00',end:'17:00',status:'HELD',expiresAt:new Date(Date.now()+240000).toISOString()};
test('payment application follows captured prepay payload and never reports phone delivery',async()=>{
  const calls=[];const a=new NswttAdapter({payeeconfigid:'wechat'}, {},{transport:{async request(path,body,method){calls.push({path,body,method});return {payeetype:10,credential:{timestamp:123,noncestr:'nonce',package:'prepay_id=test',signtype:'RSA',sign:'signature'}};}}});
  a.getOrder=async()=>hold;
  const result=await a.applyPayment(hold);
  assert.deepEqual(calls,[{path:'wtt/sport/order/payapply',body:{id:'order',payeeconfigid:'wechat',prepaydata:{goodstag:''}},method:'POST'}]);
  assert.equal(result.phoneSent,false);assert.equal(result.status,'CREDENTIAL_READY');
  assert.equal(result.requestPayment.timeStamp,'123');
});
test('expired or changed orders cannot initiate payment',async()=>{
  for(const changed of [{status:'OTHER'},{start:'14:00'},{courtId:'other'},{expiresAt:new Date(0).toISOString()}]){
    let calls=0;const a=new NswttAdapter({}, {},{transport:{request(){calls++;throw Error('Must not be called');}}});
    a.getOrder=async()=>({...hold,...changed});await assert.rejects(a.applyPayment(hold));assert.equal(calls,0);
  }
});
