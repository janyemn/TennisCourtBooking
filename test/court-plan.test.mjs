import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCourt} from '../src/engine.mjs';
import {samePlan,filterCourts} from '../src/court-plan.mjs';
import {normalizeOrder} from '../src/nswtt-adapter.mjs';
const rows=[{id:'a',courtId:'3',start:'19:00',end:'20:00',available:true},{id:'b',courtId:'5',start:'20:00',end:'21:00',available:true}];
test('跨场必须显式允许，连续覆盖且优先同场',()=>{
 assert.equal(chooseCourt(rows),null);
 const mixed=chooseCourt(rows,'19:00','21:00',true);assert.deepEqual(mixed.slotIds,['a','b']);assert.equal(mixed.segments.length,2);
 assert.equal(chooseCourt([rows[0],{...rows[1],start:'20:30'}],'19:00','21:00',true),null);
 assert.equal(chooseCourt([...rows,{...rows[1],id:'c',courtId:'3'}],'19:00','21:00',true).courtId,'3');
 assert.equal(samePlan({...mixed,start:'19:00',end:'21:00'},{segments:[{courtId:'3',start:'19:00',end:'21:00'}]}),false);
});
test('大沙河默认排除高价场，勾选后放行，其他场馆不受影响',()=>{
 const p={target:{sportId:'1f2c23a3-3720-44c8-b78b-971d8860fbac'}};
 const slots=[...rows,{...rows[0],courtId:'4cd18fd4-5833-486e-ae80-e90db1220f77'},{...rows[1],courtId:'b10ff116-4e06-4f09-ad6a-c4172cd152da'}];
 assert.equal(filterCourts(slots,p).length,2);assert.equal(filterCourts(slots,p,true).length,4);assert.equal(filterCourts(slots,{target:{sportId:'campus'}}).length,4);
});
test('订单核验识别真实跨场时段，错场或缺口不匹配',()=>{
 const profile={target:{venueId:'v',sportId:'p'},selfHash:'self'},project={placelist:[{id:'3',name:'3号场'},{id:'5',name:'5号场'}]};
 const raw={id:'o',projectid:'p',extid:'v',paytype:2,playerlist:[{idcardhash:'self'}],status:50,countdown:60,slicestarttime:'2026-09-12 19:00:00',sliceendtime:'2026-09-12 21:00:00',slicememo:'3号场 (2026-09-12 19:00-20:00)\n5号场 (2026-09-12 20:00-21:00)'};
 const order=normalizeOrder(raw,profile,project,Date.now());assert.equal(samePlan(order,chooseCourt(rows,'19:00','21:00',true)),true);
 assert.throws(()=>normalizeOrder({...raw,slicememo:raw.slicememo.replace('20:00-21:00','20:30-21:00')},profile,project,Date.now()));
});
