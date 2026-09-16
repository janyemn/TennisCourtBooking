import test from 'node:test';
import assert from 'node:assert/strict';
import {venueProfile,getVenue,jobVenue} from '../src/venues.mjs';
import {NswttAdapter} from '../src/nswtt-adapter.mjs';
test('场馆切换保留本人身份，但替换项目、收款方式和规则',()=>{
 const base={identity:'市民',target:{accountId:'self',venueId:'campus',sportId:'campus-tennis'},selfHash:'self',playerIds:['player'],extype:41,payeeconfigid:'campus-pay'};
 const d=venueProfile(base,'dashahe');
 assert.equal(d.target.accountId,'self');assert.equal(d.extype,10);assert.equal(d.releaseAt,'11:00');
 assert.notEqual(d.target.sportId,base.target.sportId);assert.notEqual(d.payeeconfigid,base.payeeconfigid);
 assert.equal(base.extype,41);assert.equal(jobVenue({}),'campus');assert.equal(getVenue('dashahe').maxMinutes,240);
 assert.throws(()=>getVenue('unknown'));assert.throws(()=>venueProfile({...base,identity:'师生'},'dashahe'));
});
test('大沙河校验使用本场馆规则，错误场馆不可继续',async()=>{
 const profile=venueProfile({identity:'市民',target:{accountId:'self'},selfHash:'self',playerIds:['player']},'dashahe');
 const project={id:profile.target.sportId,extid:profile.target.venueId,extname:profile.venueName,sporttype:'tennis',ruleconfig:{slicesaletime:'11:00'},paytypes:'2'};
 const adapter=new NswttAdapter(profile,{}, {transport:{request:async path=>path.endsWith('project/info')?project:path.includes('playerstore')?{list:[{id:'player',status:200,idcardhash:'self'}]}:{count:0,list:[]}}});
 await adapter.prepare();project.extname='深圳大学城体育中心';await assert.rejects(adapter.prepare(),/规则/);
});
