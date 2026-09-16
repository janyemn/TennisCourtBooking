import test from 'node:test';
import assert from 'node:assert/strict';
import {proxySummary} from '../src/sync-diagnostics.mjs';
test('检测Clash覆盖代理、关闭代理以及PAC冲突',()=>{
 const text='ProxyEnable    REG_DWORD    0x1\nProxyServer    REG_SZ    127.0.0.1:17897';
 assert.equal(proxySummary(text).matches,false);
 assert.equal(proxySummary(text.replace('17897','8899')).matches,true);
 assert.equal(proxySummary(text.replace('17897','8899').replace('0x1','0x0')).matches,false);
 assert.equal(proxySummary(text.replace('17897','8899')+'\nAutoConfigURL    REG_SZ    http://local/proxy.pac').matches,false);
});
