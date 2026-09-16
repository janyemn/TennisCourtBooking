import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReservation,reconcileJobRecords,applyReconciliation} from '../src/reconcile.mjs';
const previous={state:'UNKNOWN',selected:{date:'2026-09-11',start:'15:00',end:'17:00',courtId:'court'}};
const cancelled={id:'order',status:250,projectid:'tennis',extid:'shown',extname:'venue',playerlist:[{idcardhash:'self'}],slicestarttime:'2026-09-11 15:00:00',sliceendtime:'2026-09-11 17:00:00',placememo:'court name'};
function adapter(orders, loginError=false){return {profile:{target:{sportId:'tennis',venueId:'venue'},selfHash:'self'},waitForLogin:async()=>{if(loginError)throw Error('用户未登录');},client:{request:async(path,params)=>{
 if(path==='wtt/sport/project/info')return {id:'tennis',extid:'venue',showextid:'shown',extname:'venue',placelist:[{id:'court',name:'court name'}]};
 if(path==='wtt/sport/order/list')return {count:orders.length,list:orders.map(o=>({id:o.id}))};
 if(path==='wtt/sport/order/info')return orders.find(o=>o.id===params.id);
 throw Error('Unexpected or mutating request');
}}};}
test('expired matched official order can release an UNKNOWN local record without placing an order',async()=>{
 const result=await reconcileReservation(adapter([cancelled]),previous);assert.equal(result.clear,true);assert.deepEqual(result.orders,[{orderId:'order',status:250}]);
});
test('pending or paid order on that date prevents clearing, even at a different time',async()=>{
 for(const status of [50,300,400])await assert.rejects(reconcileReservation(adapter([cancelled,{...cancelled,id:'other',status,slicestarttime:'2026-09-11 14:00:00'}]),previous),/不能重复/);
});
test('no matching order, wrong participant, or invalid session cannot release the record',async()=>{
 await assert.rejects(reconcileReservation(adapter([]),previous));
 await assert.rejects(reconcileReservation(adapter([{...cancelled,playerlist:[]}]),previous));
 await assert.rejects(reconcileReservation(adapter([cancelled],true),previous),/未登录/);
});
test('archived journal still reconciles stale payment task and retains order history',async()=>{
 const jobs=[{status:'payment_ready',result:{...previous.selected,orderId:'order'}}];
 const result=await reconcileJobRecords(adapter([cancelled]),null,jobs);
 applyReconciliation(jobs,result);
 assert.equal(jobs[0].status,'expired');
 assert.equal(jobs[0].result.orderId,'order');
 assert.ok(jobs[0].orderCheckedAt);
});
test('pending order or failed official check never clears stale task',async()=>{
 for(const orders of [[{...cancelled,status:50}],[],[{...cancelled,id:'different'}]]){
  const jobs=[{status:'payment_ready',result:{...previous.selected,orderId:'order'}}];
  await assert.rejects(reconcileJobRecords(adapter(orders),null,jobs));
  assert.equal(jobs[0].status,'payment_ready');
 }
});
test('only matching verified terminal orders update jobs',()=>{
 const jobs=[{status:'payment_failed',result:{orderId:'one'}},{status:'payment_ready',result:{orderId:'two'}},{status:'scheduled'}];
 applyReconciliation(jobs,{clear:true,orders:[{orderId:'one',status:200}],checkedAt:'now'});
 assert.deepEqual(jobs.map(j=>j.status),['order_cancelled','payment_ready','scheduled']);
});
test('known order skips unrelated terminal details but still checks active orders',async()=>{
 const a=adapter([cancelled]), base=a.client.request, details=[];
 a.client.request=async(path,params)=>{
  if(path.endsWith('/list'))return {count:3,list:[{id:'order',status:250},{id:'old',status:200},{id:'expired',status:250}]};
  if(path==='wtt/sport/order/info')details.push(params.id);
  return base(path,params);
 };
 const result=await reconcileReservation(a,{...previous,hold:{orderId:'order'}});
 assert.equal(result.clear,true);assert.deepEqual(details,['order']);
 a.client.request=async(path,params)=>{
  if(path.endsWith('/list'))return {count:2,list:[{id:'order',status:250},{id:'active',status:50}]};
  if(path.endsWith('/info')&&params.id==='active')return {...cancelled,id:'active',status:50};
  return base(path,params);
 };
 await assert.rejects(reconcileReservation(a,{...previous,hold:{orderId:'order'}}),/不能重复/);
});
