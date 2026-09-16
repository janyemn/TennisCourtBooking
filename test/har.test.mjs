import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHar, extractSession } from '../src/har.mjs';

const har = { log: { entries: [{ request: {
  url: 'https://booking.example.test/slots?token=QUERY_SECRET', method: 'POST',
  headers: [{ name: 'Cookie', value: 'COOKIE_SECRET' }], postData: { text: '{"password":"PASSWORD_SECRET"}' }
}, response: { status: 200, content: { text: '{"data":{"user":"PRIVATE_VALUE"}}' } } }] } };
test('HAR摘要不包含会话、查询参数、正文值', () => {
  const result = JSON.stringify(inspectHar(har));
  assert.ok(!/QUERY_SECRET|COOKIE_SECRET|PASSWORD_SECRET|PRIVATE_VALUE/.test(result));
  assert.match(result, /data.user/);
});
test('仅导入明确选择的会话头并按来源保存', () => {
  const session = extractSession(har, 0, ['Cookie']);
  assert.deepEqual(session.origins['https://booking.example.test'].headers, { cookie: 'COOKIE_SECRET' });
  assert.throws(() => extractSession(har, 0, ['Host']), /不能导入/);
  assert.throws(() => extractSession(har, 0, ['Authorization']), /缺失/);
});
