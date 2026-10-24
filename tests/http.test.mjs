import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

async function app(t, options = {}) {
  let time = Date.parse('2026-10-25T02:00:00Z');
  const store = new Store({ now: () => time, ...(options.production ? { development: false, adProvider: 'disabled' } : {}) });
  const admin = randomBytes(32).toString('hex');
  const { server } = createApp({ store, adminToken: admin, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, { method = 'GET', data, token = '', headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  return { request, base, admin, store, advance: ms => { time += ms; } };
}

test('浏览器页面、后台和静态资源通过真实HTTP提供，源码和.env不暴露', async t => {
  const { base, request } = await app(t);
  for (const file of ['/', '/admin', '/app.js', '/style.css', '/admin.js']) {
    const response = await fetch(base + file); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  for (const file of ['/server/store.mjs', '/.env', '/not-found']) assert.equal((await fetch(base + file)).status, 404);
  assert.equal((await request('/api/health')).data.realPayments, false);
});

test('并发HTTP完成同一任务，余额只增加一次', async t => {
  const { request, advance } = await app(t);
  const login = await request('/api/auth/demo', { method: 'POST', data: { installationId: 'http_installation_user' } });
  assert.equal(login.status, 200); const token = login.data.token;
  const task = await request('/api/tasks', { method: 'POST', token, data: { kind: 'bag', base: 99999999, subsidy: 99999999 } });
  assert.equal(task.status, 200); assert.equal(task.data.total, 100);
  advance(3000);
  const results = await Promise.all(Array.from({ length: 12 }, () => request('/api/tasks/' + task.data.id + '/complete', { method: 'POST', token, data: { coins: 999999999 } })));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results.filter(r => !r.data.alreadyClaimed).length, 1);
  assert.equal((await request('/api/me', { token })).data.balance, 3700);
});

test('管理员鉴权、跨站拒绝、JSON校验和请求大小限制', async t => {
  const { request, base, admin } = await app(t);
  assert.equal((await request('/api/me')).status, 401);
  assert.equal((await request('/api/admin/overview')).status, 401);
  assert.equal((await request('/api/admin/overview', { token: admin })).status, 200);
  assert.equal((await request('/api/config', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const invalid = await fetch(base + '/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/auth/demo', { method: 'POST', data: { installationId: 'x'.repeat(17000) } })).status, 413);
  const login = await request('/api/auth/demo', { method: 'POST', data: { installationId: 'http_regular_user' } });
  assert.equal((await request('/api/admin/overview', { token: login.data.token })).status, 401);
});

test('演示提现HTTP全流程，审核与退款均有审计', async t => {
  const { request, admin } = await app(t);
  const login = await request('/api/auth/demo', { method: 'POST', data: { installationId: 'http_withdraw_user' } });
  const token = login.data.token;
  const order = await request('/api/withdrawals', { method: 'POST', token, data: { coins: 1000, requestKey: 'http_request_0001' } });
  assert.equal(order.status, 200);
  const review = await request('/api/admin/withdrawals/' + order.data.id + '/review', { method: 'POST', token: admin, data: { action: 'reject', reason: '演示退款检查' } });
  assert.equal(review.status, 200);
  const user = (await request('/api/me', { token })).data;
  assert.equal(user.balance, 3600); assert.equal(user.frozen, 0);
  assert.ok((await request('/api/admin/overview', { token: admin })).data.audit.some(a => a.action === 'withdrawal.reject'));
});

test('微信登录仅由服务端交换，客户端不获得session_key；正式模式关闭演示', async t => {
  let called = false;
  const { request } = await app(t, { production: true, wxAppId: 'test-app-id', wxAppSecret: 'test-secret', fetcher: async url => {
    called = true; assert.equal(url.hostname, 'api.weixin.qq.com'); assert.equal(url.searchParams.get('js_code'), 'temporary-code');
    return new Response(JSON.stringify({ openid: 'test-platform-user', session_key: 'not-for-client' }), { status: 200 });
  } });
  const login = await request('/api/auth/wechat', { method: 'POST', data: { code: 'temporary-code' } });
  assert.equal(login.status, 200); assert.equal(called, true); assert.equal(login.data.user.balance, 0);
  assert.equal(JSON.stringify(login.data).includes('not-for-client'), false);
  assert.equal((await request('/api/auth/demo', { method: 'POST', data: { installationId: 'http_prod_user' } })).status, 403);
  assert.equal((await request('/api/tasks', { method: 'POST', token: login.data.token, data: { kind: 'bag' } })).status, 503);
  assert.equal((await request('/api/withdrawals', { method: 'POST', token: login.data.token, data: { coins: 1000, requestKey: 'http_prod_req' } })).status, 503);
});
