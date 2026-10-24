import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DinnerStore } from "../server/store.mjs";
import { createDinnerApp } from "../server/index.mjs";
async function fixture(t, options = {}) {
  const s = new DinnerStore({ development: !options.production });
  const admin = randomBytes(32).toString("hex");
  const { server } = createDinnerApp({
    store: s,
    adminToken: admin,
    ...options,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    s.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (
    path,
    { method = "GET", data, token = "", headers = {} } = {},
  ) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: r.status, data: await r.json() };
  };
  const a = options.production
    ? null
    : await request("/api/auth/demo", {
        method: "POST",
        data: { installationId: "http_dinner_installation" },
      });
  return { s, admin, base, request, token: a?.data.token, u: a?.data.user.id };
}
test("页面、资源和新品牌可访问，后端文件和配置不暴露", async (t) => {
  const { base, request } = await fixture(t);
  for (const file of [
    "/",
    "/admin",
    "/app.js",
    "/shared.js",
    "/assets/tomato.svg",
  ])
    assert.equal((await fetch(base + file)).status, 200);
  for (const file of ["/.env.wanfan", "/server/store.mjs"])
    assert.equal((await fetch(base + file)).status, 404);
  const h = await request("/api/health");
  assert.equal(h.data.product, "wanfan");
  assert.equal(h.data.realAds, false);
});
test("HTTP主流程：库存、菜单、缺料、完成和历史", async (t) => {
  const { request, token } = await fixture(t);
  assert.equal(
    (
      await request("/api/pantry", {
        method: "PUT",
        token,
        data: { ingredientId: "egg", amount: 2, expires: null },
      })
    ).status,
    200,
  );
  const p = await request("/api/plans", {
    method: "POST",
    token,
    data: { recipeId: "tomato-egg", servings: 2 },
  });
  assert.equal(p.status, 200);
  const list = await request("/api/shopping", { token });
  assert.equal(list.data.find((i) => i.id === "egg").missing, 1);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      request("/api/plans/" + p.data.id + "/complete", {
        method: "POST",
        token,
        data: {},
      }),
    ),
  );
  assert.equal(results.filter((r) => !r.data.alreadyCompleted).length, 1);
  assert.equal(
    (await request("/api/journal", { token })).data.history.length,
    1,
  );
});
test("用户不能调用管理接口，跨站及错误输入被拒绝", async (t) => {
  const { request, base, token, admin } = await fixture(t);
  assert.equal((await request("/api/dashboard")).status, 401);
  assert.equal((await request("/api/admin/overview", { token })).status, 401);
  assert.equal(
    (await request("/api/admin/overview", { token: admin })).status,
    200,
  );
  assert.equal(
    (
      await request("/api/config", {
        headers: { Origin: "https://other.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/auth/demo", {
        method: "POST",
        data: { installationId: "x".repeat(17000) },
      })
    ).status,
    413,
  );
  const r = await fetch(base + "/api/checkin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: "invalid",
  });
  assert.equal(r.status, 400);
});
test("HTTPS反向代理显式源站可用，未授权源站仍被拒绝", async (t) => {
  const { request, token } = await fixture(t, {
    publicOrigin: "https://dinner.example.com",
  });
  assert.equal(
    (
      await request("/api/dashboard", {
        token,
        headers: { Origin: "https://dinner.example.com" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/dashboard", {
        token,
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.throws(() =>
    createDinnerApp({ publicOrigin: "https://dinner.example.com/path" }),
  );
});
test("真实商业接口硬关闭，客户端伪造观看或金额也不能开启", async (t) => {
  const { request, token } = await fixture(t);
  for (const path of ["/api/rewards/tasks", "/api/withdrawals"]) {
    const r = await request(path, {
      method: "POST",
      token,
      data: { isEnded: true, amount: 1000 },
    });
    assert.equal(r.status, 503);
    assert.equal(r.data.error.code, "CAPABILITY_DISABLED");
  }
});
test("内部权益通过管理员授予，原账户可实际生成周计划", async (t) => {
  const { request, token, u, admin } = await fixture(t);
  assert.equal(
    (await request("/api/week/generate", { method: "POST", token, data: {} }))
      .status,
    403,
  );
  const path = "/api/admin/users/" + u + "/grant";
  assert.equal(
    (await request(path, { method: "POST", token, data: {} })).status,
    401,
  );
  assert.equal(
    (await request(path, { method: "POST", token: admin, data: {} })).status,
    200,
  );
  assert.equal(
    (await request("/api/week/generate", { method: "POST", token, data: {} }))
      .data.days.length,
    7,
  );
});
test("真实微信登录接口仅模拟上游验证，不下发session_key；生产模拟权限关闭", async (t) => {
  const { request, admin } = await fixture(t, {
    production: true,
    wxAppId: "test-id",
    wxAppSecret: "test-secret",
    fetcher: async (url) => {
      assert.equal(url.hostname, "api.weixin.qq.com");
      return new Response(
        JSON.stringify({
          openid: "test-openid",
          session_key: "private-session-value",
        }),
      );
    },
  });
  const login = await request("/api/auth/wechat", {
    method: "POST",
    data: { code: "one-time-code" },
  });
  assert.equal(login.status, 200);
  assert.equal(
    JSON.stringify(login.data).includes("private-session-value"),
    false,
  );
  assert.equal(
    (
      await request("/api/auth/demo", {
        method: "POST",
        data: { installationId: "not_allowed_demo" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/users/" + login.data.user.id + "/grant", {
        method: "POST",
        token: admin,
        data: {},
      })
    ).status,
    403,
  );
});
test("删除需要确认并立即使旧会话失效", async (t) => {
  const { request, token } = await fixture(t);
  assert.equal(
    (
      await request("/api/account", {
        method: "DELETE",
        token,
        data: { confirm: "NO" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/account", {
        method: "DELETE",
        token,
        data: { confirm: "DELETE" },
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/dashboard", { token })).status, 401);
});
