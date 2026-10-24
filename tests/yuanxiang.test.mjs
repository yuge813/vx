import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { Store, AppError } from "../server/store.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { randomBytes } from "node:crypto";
const fails = (fn, status) =>
  assert.throws(fn, (e) => e instanceof AppError && e.status === status);
function fixture(t, { start = "2026-10-25T01:00:00Z", draw = () => 0 } = {}) {
  let now = Date.parse(start);
  const s = new YuanxiangStore({ now: () => now, draw });
  t.after(() => s.close());
  const a = s.login("yuanxiang_test_user");
  return {
    s,
    u: a.user.id,
    token: a.token,
    advance: (ms) => {
      now += ms;
    },
  };
}
function finish(s, u, kind, advance) {
  const task = s.createTask(u, kind);
  advance(3100);
  return s.completeTask(u, task.id);
}
test("新账户零金币，签到先完成激励任务且每日只入账一次", (t) => {
  const { s, u, advance } = fixture(t);
  assert.equal(s.profile(u).balance, 0);
  assert.equal(s.ledger(u).length, 0);
  fails(() => s.checkin(u), 409);
  const task = s.createTask(u, "signin");
  assert.equal(s.createTask(u, "signin").id, task.id);
  fails(() => s.completeTask(u, task.id), 409);
  advance(3100);
  s.completeTask(u, task.id);
  s.completeTask(u, task.id);
  assert.equal(s.profile(u).balance, 620);
  assert.equal(s.profile(u).signedToday, true);
  assert.equal(s.profile(u).week.at(-1).signed, true);
  fails(() => s.createTask(u, "signin"), 409);
});
test("两分钟叠包，关闭保留，继续叠到8888不超过上限", (t) => {
  const { s, u, advance } = fixture(t);
  assert.ok(s.group(u).banks.every((b) => b.coins === 0));
  advance(120000);
  let group = s.group(u);
  assert.ok(group.banks.every((b) => b.coins === 390));
  s.skip(u, "redpacket");
  s.skip(u, "redpacket");
  assert.equal(
    s.group(u).feed.filter((f) => f.title.includes("暂存")).length,
    1,
  );
  advance(120000);
  assert.equal(s.group(u).banks[0].coins, 780);
  advance(24 * 120000);
  group = s.group(u);
  assert.ok(group.banks.every((b) => b.coins === 8888));
  assert.equal(s.adminOverview().packetReserves, 17776);
  advance(86400000);
  assert.ok(s.group(u).banks.every((b) => b.coins === 8888));
  assert.equal(s.adminOverview().packetReserves, 17776);
});
test("红包任务创建锁金额，取消只释放补贴，继续保留基础预算", (t) => {
  const { s, u, advance } = fixture(t);
  advance(120000);
  s.group(u);
  const task = s.createTask(u, "redpacket");
  assert.equal(task.total, 410);
  assert.equal(s.adminOverview().budget.reserved, 800);
  assert.equal(
    s.group(u).banks.find((b) => b.kind === "redpacket").locked,
    true,
  );
  s.cancelTask(u, task.id);
  s.cancelTask(u, task.id);
  assert.equal(s.adminOverview().budget.reserved, 780);
  assert.equal(s.group(u).banks.find((b) => b.kind === "redpacket").coins, 390);
  assert.equal(s.profile(u).balance, 0);
});
test("完成红包只结算一次，清空当前池并保留另一个池", (t) => {
  const { s, u, advance } = fixture(t);
  advance(120000);
  s.group(u);
  const task = s.createTask(u, "redpacket");
  advance(3100);
  s.completeTask(u, task.id);
  s.completeTask(u, task.id);
  assert.equal(s.profile(u).balance, 410);
  const banks = s.group(u).banks;
  assert.equal(banks.find((b) => b.kind === "redpacket").coins, 0);
  assert.equal(banks.find((b) => b.kind === "treasure").coins, 390);
  assert.equal(s.adminOverview().packetReserves, 390);
  assert.equal(s.ledger(u).filter((l) => l.reference === task.id).length, 2);
});
test("红包任务过期只释放补贴，不把基础预留重复释放", (t) => {
  const { s, u, advance } = fixture(t);
  advance(120000);
  s.group(u);
  const task = s.createTask(u, "treasure");
  advance(1800001);
  s.pruneExpired();
  assert.equal(s.task(u, task.id).state, "expired");
  assert.equal(
    s.db.prepare("SELECT reserved FROM budgets").get().reserved,
    780,
  );
  assert.equal(
    s.db
      .prepare("SELECT coins FROM banks WHERE user_id=? AND kind='treasure'")
      .get(u).coins,
    390,
  );
  fails(() => s.completeTask(u, task.id), 409);
  assert.equal(
    s.db.prepare("SELECT reserved FROM budgets").get().reserved,
    780,
  );
});
test("跨日叠包按各日期分配预算，不重复扣减", (t) => {
  const { s, u, advance } = fixture(t, { start: "2026-10-25T15:57:00Z" });
  advance(120000);
  s.group(u);
  advance(120000);
  s.group(u);
  const task = s.createTask(u, "redpacket");
  advance(3100);
  s.completeTask(u, task.id);
  const before = s.db
      .prepare("SELECT * FROM budgets WHERE day=?")
      .get("2026-10-25"),
    after = s.db.prepare("SELECT * FROM budgets WHERE day=?").get("2026-10-26");
  assert.equal(before.spent, 390);
  assert.equal(before.reserved, 390);
  assert.equal(after.spent, 410);
  assert.equal(after.reserved, 390);
  assert.equal(s.profile(u).balance, 800);
});
test("预算不足暂停新叠加，已保留金币不被清掉", (t) => {
  const { s, u, advance } = fixture(t);
  s.updateSettings({ dailyBudgetCoins: 500 });
  advance(120000);
  let g = s.group(u);
  assert.equal(
    g.banks.reduce((n, b) => n + b.coins, 0),
    390,
  );
  advance(120000);
  g = s.group(u);
  assert.equal(
    g.banks.reduce((n, b) => n + b.coins, 0),
    390,
  );
  const b = g.banks.find((b) => b.coins);
  const task = s.createTask(u, b.kind);
  advance(3100);
  s.completeTask(u, task.id);
  assert.equal(s.profile(u).balance, 410);
  fails(() => s.updateSettings({ dailyBudgetCoins: 1 }), 409);
});
test("改补贴和叠包规则不追改已创建任务或当前轮", (t) => {
  const { s, u, advance } = fixture(t);
  advance(120000);
  s.group(u);
  const task = s.createTask(u, "redpacket");
  s.updateSettings({
    subsidyCoins: 100,
    packetIncrement: 500,
    packetCap: 9000,
  });
  advance(3100);
  s.completeTask(u, task.id);
  assert.equal(s.profile(u).balance, 410);
  const g = s.group(u);
  assert.equal(g.banks.find((b) => b.kind === "redpacket").increment, 500);
  assert.equal(g.banks.find((b) => b.kind === "treasure").increment, 390);
});
test("福袋开奖前不暴露结果，概率及结果按任务快照锁定", (t) => {
  const { s, u, advance } = fixture(t, { draw: () => 99 });
  const task = s.createTask(u, "bag");
  assert.equal("base" in task, false);
  assert.equal("total" in task, false);
  assert.equal(
    s.task(u, task.id).prizes.find((p) => p.coins === 500).weight,
    3,
  );
  s.updateSettings({
    prize80Weight: 100,
    prize120Weight: 0,
    prize200Weight: 0,
    prize500Weight: 0,
  });
  assert.equal(
    s.task(u, task.id).prizes.find((p) => p.coins === 500).weight,
    3,
  );
  advance(3100);
  const result = s.completeTask(u, task.id);
  assert.equal(result.task.base, 500);
  assert.equal(result.task.total, 520);
  assert.equal(s.profile(u).balance, 520);
});
test("取消福袋保留冷却，错误概率总和拒绝", (t) => {
  const { s, u, advance } = fixture(t);
  const task = s.createTask(u, "bag");
  s.cancelTask(u, task.id);
  fails(() => s.createTask(u, "bag"), 409);
  advance(60000);
  assert.ok(s.createTask(u, "bag").id);
  fails(() => s.updateSettings({ prize80Weight: 99 }), 400);
});
test("分类型及总次数后端执行，拦截有审计", (t) => {
  const { s, u, advance } = fixture(t);
  s.updateSettings({ dailyAdLimit: 2, bagLimit: 1 });
  finish(s, u, "signin", advance);
  finish(s, u, "bag", advance);
  advance(120000);
  fails(() => s.createTask(u, "bag"), 409);
  fails(() => s.createTask(u, "redpacket"), 409);
  assert.equal(s.profile(u).adsToday, 2);
  assert.ok(
    s.adminOverview().audit.some((a) => a.action === "risk.task_blocked"),
  );
});
test("账户限制停止新任务及累计，但允许申诉、登录和完成既有承诺", (t) => {
  const { s, u, advance } = fixture(t);
  const task = s.createTask(u, "signin");
  s.updateUser(u, {
    status: "restricted",
    dailyLimit: null,
    reason: "异常行为人工复核",
  });
  assert.equal(s.login("yuanxiang_test_user").user.id, u);
  fails(() => s.createTask(u, "bag"), 403);
  s.support(u, "任务受限，请复核");
  assert.equal(s.supportList(u).length, 1);
  advance(3100);
  s.completeTask(u, task.id);
  assert.equal(s.profile(u).balance, 620);
  advance(120000);
  assert.ok(s.group(u).banks.every((b) => b.coins === 0));
});
test("跨账户不能完成或取消他人的任务，群动态不串号", (t) => {
  const { s, u, advance } = fixture(t);
  const other = s.login("another_yuanxiang_user").user.id;
  const task = s.createTask(u, "signin");
  advance(3100);
  fails(() => s.completeTask(other, task.id), 404);
  fails(() => s.cancelTask(other, task.id), 404);
  s.completeTask(u, task.id);
  assert.equal(
    s.group(other).feed.some((f) => f.kind === "signin"),
    false,
  );
});
test("邀请单层绑定真实记录，拒绝自邀、改绑及循环", (t) => {
  const { s, u } = fixture(t),
    b = s.login("invite_yuan_user_b").user.id,
    c = s.login("invite_yuan_user_c").user.id;
  const ac = s.referral(u).code,
    bc = s.referral(b).code,
    cc = s.referral(c).code;
  s.bindReferral(b, ac);
  s.bindReferral(b, ac);
  s.bindReferral(c, bc);
  assert.equal(s.referral(u).invitedCount, 1);
  assert.equal(s.referral(b).invitedCount, 1);
  fails(() => s.bindReferral(u, ac), 400);
  fails(() => s.bindReferral(b, cc), 409);
  fails(() => s.bindReferral(u, cc), 409);
  assert.equal(s.referral(u).cashCommissionEnabled, false);
});
test("邀请活跃来自成功任务；24小时后不可补绑", (t) => {
  const { s, u, advance } = fixture(t),
    other = s.login("referral_active_user").user.id;
  const code = s.referral(u).code;
  s.bindReferral(other, code);
  assert.equal(s.referral(u).activeCount, 0);
  finish(s, other, "signin", advance);
  assert.equal(s.referral(u).activeCount, 1);
  const late = s.login("referral_late_user").user.id;
  advance(86400001);
  fails(() => s.bindReferral(late, code), 409);
});
test("签到、红包赚到的金币可走真实账务的模拟申请冻结退款", (t) => {
  const { s, u, advance } = fixture(t);
  finish(s, u, "signin", advance);
  advance(120000);
  s.group(u);
  finish(s, u, "redpacket", advance);
  assert.equal(s.profile(u).balance, 1030);
  const order = s.withdraw(u, 1000, "yx_withdraw_request_1");
  assert.equal(s.profile(u).balance, 30);
  assert.equal(s.profile(u).frozen, 1000);
  s.withdraw(u, 1000, "yx_withdraw_request_1");
  s.reviewWithdrawal(order.id, "reject", "开发复核退回");
  s.reviewWithdrawal(order.id, "reject", "开发复核退回");
  assert.equal(s.profile(u).balance, 1030);
  assert.equal(s.profile(u).frozen, 0);
});
test("正式模式关闭开发登录、模拟发奖、计时推进和付款", (t) => {
  const s = new YuanxiangStore({ development: false, adProvider: "disabled" });
  t.after(() => s.close());
  fails(() => s.login("forbidden_demo_user"), 403);
  const u = s.login("wx:test-open-id", false).user.id;
  fails(() => s.createTask(u, "signin"), 503);
  fails(() => s.completeTask(u, "none"), 403);
  fails(() => s.demoReady(u), 403);
  fails(() => s.withdraw(u, 1000, "yx_prod_request_1"), 503);
  fails(() => s.updateSettings({ cashTransfersEnabled: true }), 400);
});
test("旧金币数据库被拒绝，开发重启保留新金币与叠包", () => {
  const dir = mkdtempSync(join(tmpdir(), "yx-db-"));
  let s, old;
  try {
    const legacy = join(dir, "old.sqlite");
    old = new Store({ path: legacy });
    const prior = old.login("old_wallet_account");
    old.close();
    old = null;
    assert.throws(() => new YuanxiangStore({ path: legacy }), /独立/);
    old = new Store({ path: legacy });
    assert.equal(old.profile(prior.user.id).balance, 3600);
    old.close();
    old = null;
    const path = join(dir, "yuanxiang.sqlite");
    let now = Date.now();
    s = new YuanxiangStore({ path, now: () => now });
    const u = s.login("persistent_yuan_user").user.id;
    now += 120000;
    s.group(u);
    s.close();
    s = new YuanxiangStore({ path, now: () => now });
    assert.equal(s.login("persistent_yuan_user").user.id, u);
    assert.equal(s.group(u).banks[0].coins, 390);
    assert.equal(s.profile(u).balance, 0);
  } finally {
    s?.close();
    old?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function httpFixture(t) {
  let now = Date.parse("2026-10-25T01:00:00Z");
  const s = new YuanxiangStore({ now: () => now }),
    admin = randomBytes(32).toString("hex");
  const { server } = createYuanxiangApp({ store: s, adminToken: admin });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    s.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const api = async (path, { method = "GET", data, token = "" } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: r.status, data: await r.json() };
  };
  const login = await api("/api/auth/demo", {
    method: "POST",
    data: { installationId: "yuan_http_user_01" },
  });
  return {
    s,
    admin,
    api,
    base,
    token: login.data.token,
    u: login.data.user.id,
    advance: (ms) => {
      now += ms;
    },
  };
}
test("红包群HTTP拓展与并发领取走同一事务，仅成功一次", async (t) => {
  const { api, token, advance } = await httpFixture(t);
  advance(120000);
  const g = await api("/api/group", { token });
  assert.equal(g.status, 200);
  const task = await api("/api/tasks", {
    method: "POST",
    token,
    data: { kind: "redpacket", base: 99999999 },
  });
  assert.equal(task.data.total, 410);
  advance(3100);
  const list = await Promise.all(
    Array.from({ length: 10 }, () =>
      api("/api/tasks/" + task.data.id + "/complete", {
        method: "POST",
        token,
        data: { isEnded: true, coins: 9999999 },
      }),
    ),
  );
  assert.equal(list.filter((r) => !r.data.alreadyClaimed).length, 1);
  assert.equal((await api("/api/me", { token })).data.balance, 410);
});
test("后台可回复申诉；普通用户不能越权审核或回复", async (t) => {
  const { api, token, admin } = await httpFixture(t);
  const ticket = await api("/api/support", {
    method: "POST",
    token,
    data: { message: "签到任务网络中断，请协助查询" },
  });
  const path = "/api/admin/support/" + ticket.data.ticket + "/reply";
  assert.equal(
    (await api(path, { method: "POST", token, data: { reply: "测试回复" } }))
      .status,
    401,
  );
  assert.equal(
    (
      await api(path, {
        method: "POST",
        token: admin,
        data: { reply: "请查询原任务，重复提交不会重复发奖" },
      })
    ).status,
    200,
  );
  const mine = await api("/api/support", { token });
  assert.equal(mine.data[0].state, "resolved");
  assert.match(mine.data[0].reply, /原任务/);
});
test("新页面不包含菜谱功能，广告和现金能力公开标明未接入", async (t) => {
  const { base, api } = await httpFixture(t);
  const home = await (await fetch(base)).text();
  assert.match(home, /悦享金币/);
  assert.doesNotMatch(home, /晚饭|菜谱/);
  const config = (await api("/api/config")).data;
  assert.equal(config.cashTransfersEnabled, false);
  assert.equal(config.adSlots.banner, "disabled");
  assert.equal(config.referralCashEnabled, false);
  assert.equal(
    config.prizes.reduce((n, p) => n + p.weight, 0),
    100,
  );
});
