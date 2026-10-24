import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { DinnerStore } from "../server/store.mjs";
import { createDinnerApp } from "../server/index.mjs";
async function native(t) {
  const s = new DinnerStore();
  const { server } = createDinnerApp({ store: s });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    s.close();
  });
  const storage = new Map(),
    module = { exports: {} },
    app = {};
  let drop = false;
  const wx = {
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, v),
    removeStorageSync: (k) => storage.delete(k),
    request(options) {
      fetch(options.url, {
        method: options.method,
        headers: options.header,
        ...(options.method === "GET"
          ? {}
          : { body: JSON.stringify(options.data ?? {}) }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (drop && options.url.endsWith("/complete") && r.ok) {
            drop = false;
            options.fail();
          } else options.success({ statusCode: r.status, data });
        })
        .catch(() => options.fail());
    },
  };
  vm.runInNewContext(
    readFileSync("wanfan/miniprogram/services/client.js", "utf8"),
    {
      module,
      wx,
      getApp: () => app,
      require: () => ({
        API_BASE: "http://127.0.0.1:" + server.address().port,
      }),
    },
  );
  const api = module.exports;
  app.ready = () => app._ready ?? (app._ready = api.initialize());
  await app.ready();
  return {
    api,
    s,
    storage,
    drop: () => {
      drop = true;
    },
  };
}
test("原生客户端连接真实HTTP后端并保存偏好与库存", async (t) => {
  const { api } = await native(t);
  await api.request("/preferences", "PUT", {
    servings: 3,
    maxMinutes: 20,
    vegetarian: true,
  });
  await api.request("/pantry", "PUT", {
    ingredientId: "egg",
    amount: 6,
    expires: null,
  });
  const d = await api.dashboard();
  assert.equal(d.user.prefs.servings, 3);
  assert.equal(d.pantry[0].amount, 6);
  assert.ok(d.recommendations.every((r) => r.vegetarian));
});
test("原生完成响应丢失后重复查询、提交原菜单不重复扣库存", async (t) => {
  const { api, drop } = await native(t);
  await api.request("/pantry", "PUT", {
    ingredientId: "egg",
    amount: 6,
    expires: null,
  });
  const p = await api.request("/plans", "POST", {
    recipeId: "tomato-egg",
    servings: 2,
  });
  drop();
  await assert.rejects(
    api.request("/plans/" + p.id + "/complete", "POST", {}),
    /连接失败/,
  );
  const again = await api.request("/plans/" + p.id + "/complete", "POST", {});
  assert.equal(again.alreadyCompleted, true);
  assert.equal((await api.request("/pantry"))[0].amount, 3);
  assert.equal((await api.request("/journal")).history.length, 1);
});
test("原生清理本地身份与删除后端记录分开且实际有效", async (t) => {
  const { api, storage } = await native(t);
  await api.request("/account", "DELETE", { confirm: "DELETE" });
  api.logoutLocal();
  assert.equal(storage.has("wanfan_token"), false);
  assert.equal(storage.has("wanfan_installation"), false);
  await assert.rejects(api.request("/me"), /登录已过期/);
});
