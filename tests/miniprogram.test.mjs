import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// 使用wx适配层验证原生客户端与真实HTTP后端的契约；不替代开发者工具或真机编译。
async function clientFixture(t) {
  let now = Date.parse('2026-10-25T02:00:00Z'), failAfterCommit = false, showModalConfirm = true;
  const store = new Store({ now: () => now }), storage = new Map();
  const { server } = createApp({ store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    request(options) {
      fetch(options.url, { method: options.method, headers: options.header, ...(options.method === 'GET' ? {} : { body: JSON.stringify(options.data ?? {}) }) })
        .then(async response => {
          const data = await response.json();
          if (failAfterCommit && options.url.endsWith('/complete') && response.ok) { failAfterCommit = false; options.fail(); }
          else options.success({ statusCode: response.status, data });
        }).catch(() => options.fail());
    },
    showModal: options => options.success({ confirm: showModalConfirm }), showLoading() {}, hideLoading() {}, showToast() {}
  };
  const module = { exports: {} }, app = {};
  const context = { module, wx, getApp: () => app, require: () => ({ API_BASE: base }), setTimeout: (fn, ms) => { now += ms; queueMicrotask(fn); } };
  vm.runInNewContext(readFileSync(new URL('../miniprogram/services/client.js', import.meta.url), 'utf8'), context);
  const client = module.exports;
  app.ready = () => { if (!app._ready) app._ready = client.initialize(); return app._ready; };
  await app.ready();
  return { client, store, storage, dropResponse: () => { failAfterCommit = true; }, cancelModal: () => { showModalConfirm = false; } };
}

test('原生客户端模拟领取实际记入后端，配置变更可以刷新', async t => {
  const { client, store } = await clientFixture(t);
  const result = await client.claim('bag');
  assert.equal(result.user.balance, 3700);
  assert.equal(store.ledger(result.user.id).filter(l => l.reference === result.task.id).length, 2);
  store.updateSettings({ subsidyCoins: 50 });
  await client.request('/api/config'); assert.equal(client.getConfig().subsidyCoins, 50);
});

test('原生客户端在完成响应丢失后恢复原任务，不重复观看和发奖', async t => {
  const { client, storage, dropResponse } = await clientFixture(t);
  dropResponse();
  await assert.rejects(client.claim('bag'), /连接失败/);
  assert.ok(storage.get('xingxiang_pending_task'));
  assert.equal((await client.request('/api/me')).balance, 3700);
  const recovered = await client.claim('bag');
  assert.equal(recovered.recovered, true);
  assert.equal(storage.has('xingxiang_pending_task'), false);
  const user = await client.request('/api/me');
  assert.equal(user.balance, 3700); assert.equal(user.adsToday, 1);
});

test('原生客户端取消演示释放服务端额度且不发金币', async t => {
  const { client, storage, store, cancelModal } = await clientFixture(t);
  cancelModal();
  assert.equal(await client.claim('bag'), null);
  assert.equal(storage.has('xingxiang_pending_task'), false);
  assert.equal((await client.request('/api/me')).balance, 3600);
  assert.equal(store.adminOverview().budget.reserved, 0);
});
