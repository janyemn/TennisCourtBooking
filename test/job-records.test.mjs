import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteJobRecords,visibleJobs} from '../src/job-records.mjs';
test('deleting hides records but retains official order evidence and is idempotent',()=>{
 const jobs=[{id:'a',status:'payment_ready',result:{orderId:'official'}},{id:'b',status:'failed'}];
 deleteJobRecords(jobs,['a','a'],'now');deleteJobRecords(jobs,['a'],'later');
 assert.deepEqual(visibleJobs(jobs).map(j=>j.id),['b']);assert.equal(jobs[0].deletedAt,'now');assert.equal(jobs[0].result.orderId,'official');
});
test('mixed selection containing active or missing record makes no changes',()=>{
 for(const status of ['scheduled','running']){const jobs=[{id:'a',status:'failed'},{id:'b',status}];assert.throws(()=>deleteJobRecords(jobs,['a','b']));assert.equal(jobs[0].deletedAt,undefined);assert.throws(()=>deleteJobRecords(jobs,['a','missing']));assert.equal(jobs[0].deletedAt,undefined);}
});
