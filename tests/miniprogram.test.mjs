import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import pacing from "../shared/ad-pacing.cjs";
import { readFileSync } from "node:fs";
import { Store } from "../server/store.mjs";
import { createApp, createYuanxiangApp } from "../server/index.mjs";
import { YuanxiangStore } from "../server/yuanxiang.mjs";

// 使用wx适配层验证原生客户端与真实HTTP后端的契约；不替代开发者工具或真机编译。
async function clientFixture(t, yuanxiang = false) {
  let now = Date.parse("2026-10-25T02:00:00Z"),
    failAfterCommit = false,
    showModalConfirm = true;
  const store = yuanxiang
    ? new YuanxiangStore({ now: () => now, draw: () => 0 })
    : new Store({ now: () => now });
  const storage = new Map();
  const { server } = (yuanxiang ? createYuanxiangApp : createApp)({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      fetch(options.url, {
        method: options.method,
        headers: options.header,
        ...(options.method === "GET"
          ? {}
          : { body: JSON.stringify(options.data ?? {}) }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (
            failAfterCommit &&
            options.url.endsWith("/complete") &&
            response.ok
          ) {
            failAfterCommit = false;
            options.fail();
          } else options.success({ statusCode: response.status, data });
        })
        .catch(() => options.fail());
    },
    showModal: (options) => options.success({ confirm: showModalConfirm }),
    showLoading() {},
    hideLoading() {},
    showToast() {},
  };
  const module = { exports: {} },
    app = {};
  const context = {
    module,
    wx,
    getApp: () => app,
    require: () => ({ API_BASE: base }),
    setTimeout: (fn, ms) => {
      now += ms;
      queueMicrotask(fn);
    },
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../miniprogram/services/client.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  const client = module.exports;
  app.ready = () => {
    if (!app._ready) app._ready = client.initialize();
    return app._ready;
  };
  await app.ready();
  return {
    client,
    store,
    storage,
    dropResponse: () => {
      failAfterCommit = true;
    },
    cancelModal: () => {
      showModalConfirm = false;
    },
    confirmModal: () => {
      showModalConfirm = true;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

test("原生客户端模拟领取实际记入后端，配置变更可以刷新", async (t) => {
  const { client, store } = await clientFixture(t);
  const result = await client.claim("bag");
  assert.equal(result.user.balance, 3700);
  assert.equal(
    store.ledger(result.user.id).filter((l) => l.reference === result.task.id)
      .length,
    2,
  );
  store.updateSettings({ subsidyCoins: 50 });
  await client.request("/api/config");
  assert.equal(client.getConfig().subsidyCoins, 50);
});

test("原生客户端在完成响应丢失后恢复原任务，不重复观看和发奖", async (t) => {
  const { client, storage, dropResponse } = await clientFixture(t);
  dropResponse();
  await assert.rejects(client.claim("bag"), /连接失败/);
  assert.ok(storage.get("yx_pending_task"));
  assert.equal((await client.request("/api/me")).balance, 3700);
  const recovered = await client.claim("bag");
  assert.equal(recovered.recovered, true);
  assert.equal(storage.has("yx_pending_task"), false);
  const user = await client.request("/api/me");
  assert.equal(user.balance, 3700);
  assert.equal(user.adsToday, 1);
});

test("原生客户端取消演示释放服务端额度且不发金币", async (t) => {
  const { client, storage, store, cancelModal } = await clientFixture(t);
  cancelModal();
  assert.equal(await client.claim("bag"), null);
  assert.equal(storage.has("yx_pending_task"), false);
  assert.equal((await client.request("/api/me")).balance, 3600);
  assert.equal(store.adminOverview().budget.reserved, 0);
});

test("原生新版签到确实先完成任务，零初始金币入账620", async (t) => {
  const { client } = await clientFixture(t, true);
  assert.equal((await client.request("/api/me")).balance, 0);
  const result = await client.claim("signin");
  assert.equal(result.user.balance, 620);
  assert.equal(result.user.signedToday, true);
});

test("原生新版红包取消保留叠包，提交回包丢失后恢复不重复发奖", async (t) => {
  const { client, advance, cancelModal, confirmModal, dropResponse, storage } =
    await clientFixture(t, true);
  advance(120000);
  await client.request("/api/group");
  cancelModal();
  assert.equal(await client.claim("redpacket"), null);
  assert.equal(
    (await client.request("/api/group")).banks.find(
      (b) => b.kind === "redpacket",
    ).coins,
    390,
  );
  confirmModal();
  dropResponse();
  await assert.rejects(client.claim("redpacket"), /连接失败/);
  assert.ok(storage.get("yx_pending_task"));
  const result = await client.claim("redpacket");
  assert.equal(result.recovered, true);
  assert.equal((await client.request("/api/me")).balance, 410);
  assert.equal(
    (await client.request("/api/group")).banks.find(
      (b) => b.kind === "redpacket",
    ).coins,
    0,
  );
});

test("原生聊天群页面加载真实卡片、暂存与恢复、金额更新和领取后新轮次", async (t) => {
  const { client, advance } = await clientFixture(t, true);
  let page;
  const routes = [];
  let nativeNow = Date.now();
  const previewStorage = new Map();
  const wx = {
    getStorageSync: (k) => previewStorage.get(k),
    setStorageSync: (k, v) => previewStorage.set(k, v),
    nextTick: (fn) => fn(),
    showToast() {},
    showModal() {},
    navigateTo: (r) => routes.push(r.url),
    switchTab: (r) => routes.push(r.url),
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../miniprogram/pages/group/index.js", import.meta.url),
      "utf8",
    ),
    {
      require: (path) => (path.endsWith("ad-pacing") ? pacing : client),
      getApp: () => ({ ready: () => Promise.resolve() }),
      wx,
      Date: { now: () => nativeNow },
      Page: (definition) => (page = definition),
    },
  );
  page.setData = function (patch) {
    Object.assign(this.data, patch);
  };
  await page.load();
  assert.equal(page.data.rows.filter((r) => r.type === "packet").length, 2);
  assert.ok(
    page.data.rows
      .filter((r) => r.type === "packet")
      .every((r) => r.bank.disabled),
  );
  const stepPreview = (seconds) => {
    for (let i = 0; i < seconds; i++) {
      nativeNow += 1000;
      advance(1000);
      page.tick();
    }
  };
  stepPreview(15);
  assert.equal(page.data.rows.filter((r) => r.type === "ad").length, 1);
  stepPreview(30);
  assert.equal(page.data.adPreview.current.format, "banner");
  page._visible = false;
  page.tick();
  assert.equal(page.data.adPreview.current, null);
  page._visible = true;
  page.tick();
  assert.equal(page.data.adPreview.current.format, "banner");
  page.hideAd();
  assert.equal(page.data.adPreview.current, null);
  assert.ok([...previewStorage.values()][0].blockUntil > 0);
  advance(120000);
  await page.load();
  const row = () => page.data.rows.find((r) => r.bank?.kind === "redpacket");
  assert.equal(row().bank.coins, 390);
  assert.equal(row().bank.disabled, false);
  await page.skip({ currentTarget: { dataset: { kind: "redpacket" } } });
  assert.equal(row().bank.saved, true);
  page.restore({ currentTarget: { dataset: { kind: "redpacket" } } });
  assert.equal(row().bank.saved, false);
  await page.skip({ currentTarget: { dataset: { kind: "redpacket" } } });
  advance(120000);
  await page.load();
  assert.equal(row().bank.saved, false);
  assert.equal(row().bank.coins, 780);
  page.hideAd();
  assert.equal(
    page.data.rows.some((r) => r.type === "ad"),
    false,
  );
  page.data.busy = true;
  page.tick();
  assert.equal(row().bank.disabled, true);
  page.data.busy = false;
  await page.claim({ currentTarget: { dataset: { kind: "redpacket" } } });
  assert.equal(row().bank.coins, 0);
  assert.equal(page.data.group.user.balance, 800);
  page.bag();
  page.wallet();
  assert.deepEqual(routes, ["/pages/bag/index", "/pages/wallet/index"]);
});

test("原生奖励任务全局互斥，同类并发复用一次任务，不同类型被阻止", async (t) => {
  const { client, store } = await clientFixture(t, true);
  const a = client.claim("signin"),
    b = client.claim("signin");
  assert.equal(a, b);
  await assert.rejects(client.claim("bag"), /先完成/);
  const result = await a;
  assert.equal(result.user.balance, 620);
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='signin'")
      .get().n,
    1,
  );
});

test("原生隐私页修改昵称、导出、注销申请及退出真实会话", async (t) => {
  const { client, store, storage } = await clientFixture(t, true);
  let page;
  const wx = { showToast() {}, showModal() {}, setClipboardData() {} };
  vm.runInNewContext(
    readFileSync(
      new URL("../miniprogram/pages/privacy/index.js", import.meta.url),
      "utf8",
    ),
    {
      require: () => client,
      getApp: () => ({ ready: () => Promise.resolve() }),
      wx,
      Page: (definition) => (page = definition),
    },
  );
  page.setData = function (patch) {
    Object.assign(this.data, patch);
  };
  await page.load();
  const id = page.data.user.id;
  page.data.name = "原生隐私测试";
  await page.rename();
  assert.equal(store.profile(id).name, "原生隐私测试");
  await page.exportData();
  assert.equal(JSON.parse(page.data.exportText).profile.id, id);
  assert.equal("identity" in JSON.parse(page.data.exportText).profile, false);
  page.data.agreed = true;
  page.data.reason = "停止使用原生开发账户";
  await page.closure();
  assert.equal(store.profile(id).closureRequest.state, "pending");
  await page.logout();
  assert.equal(page.data.loggedOut, true);
  assert.equal(storage.has("yx_token"), false);
  await assert.rejects(client.request("/api/me"), (e) => e.status === 401);
});
