import test from 'node:test';
import assert from 'node:assert/strict';
import {syncProgress} from '../src/sync-progress.mjs';
test('waiting is never presented as authenticated and expiry overrides stale opened message',()=>{
  const pair={openedAt:0,expiresAt:100000};
  assert.match(syncProgress(pair,{},61000).message,/尚未收到/);
  assert.equal(syncProgress(pair,{message:'已开启'},100000).phase,'expired');
  assert.equal(syncProgress(pair,{},100000).active,false);
});
test('verification rejection and successful closed window retain their outcome',()=>{
  assert.equal(syncProgress({openedAt:0,expiresAt:100000},{receivedAt:1,phase:'rejected',message:'验证失败'},61000).message,'验证失败');
  assert.equal(syncProgress(null,{message:'同步成功'},100000).message,'同步成功');
});
