import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/engine.mjs';

test('提交日志刷盘后可由新实例读取，并原子更新锁场状态', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tennis-journal-'));
  const path = join(directory, 'order.json');
  try {
    const journal = new Journal(path);
    assert.equal(await journal.read(), null);
    await journal.put({ state: 'SUBMITTING' });
    assert.deepEqual(await new Journal(path).read(), { state: 'SUBMITTING' });
    await journal.put({ state: 'HELD', orderId: 'test-only' });
    assert.equal((await new Journal(path).read()).state, 'HELD');
  } finally {
    await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await rmdir(directory);
  }
});
