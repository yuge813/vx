import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../server/store.mjs";

function fixture(t, options = {}) {
  let time = Date.parse("2026-10-25T02:00:00Z");
  const store = new Store({ now: () => time, ...options });
  t.after(() => store.close());
  const a = store.login("installation_user_one");
  return {
    store,
    id: a.user.id,
    token: a.token,
    advance: (ms) => {
      time += ms;
    },
    setTime: (value) => {
      time = Date.parse(value);
    },
  };
}
const fails = (fn, status) =>
  assert.throws(
    fn,
    (error) => error instanceof AppError && error.status === status,
  );

test("签到按北京时间每日一次，日历来自真实流水", (t) => {
  const { store, id, setTime } = fixture(t);
  setTime("2026-10-25T15:59:59Z");
  assert.equal(store.checkin(id).coins, 10);
  assert.equal(store.checkin(id).alreadyClaimed, true);
  assert.equal(store.profile(id).balance, 3610);
  assert.equal(store.profile(id).week.at(-1).signed, true);
  setTime("2026-10-25T16:00:00Z");
  assert.equal(store.profile(id).signedToday, false);
  assert.equal(store.checkin(id).coins, 10);
  assert.equal(store.profile(id).balance, 3620);
  assert.equal(store.profile(id).week.at(-2).signed, true);
});

test("重复创建和完成任务只预留一次、发奖一次，补贴独立记账", (t) => {
  const { store, id, advance } = fixture(t);
  const task = store.createTask(id, "bag");
  assert.equal(store.createTask(id, "bag").id, task.id);
  assert.equal(store.adminOverview().budget.reserved, 100);
  fails(() => store.completeTask(id, task.id), 409);
  advance(3000);
  assert.equal(store.completeTask(id, task.id).alreadyClaimed, false);
  assert.equal(store.completeTask(id, task.id).alreadyClaimed, true);
  assert.equal(store.profile(id).balance, 3700);
  assert.equal(
    store.ledger(id).filter((row) => row.reference === task.id).length,
    2,
  );
  assert.equal(store.adminOverview().budget.spent, 100);
  assert.equal(store.adminOverview().budget.reserved, 0);
});

test("取消任务只释放一次预留，不能再发奖", (t) => {
  const { store, id, advance } = fixture(t);
  const task = store.createTask(id, "bag");
  store.cancelTask(id, task.id);
  store.cancelTask(id, task.id);
  advance(3000);
  fails(() => store.completeTask(id, task.id), 409);
  assert.equal(store.adminOverview().budget.reserved, 0);
  assert.equal(store.profile(id).balance, 3600);
});

test("过期任务发奖失败后仍释放预留，不能留下永久占用", (t) => {
  const { store, id, advance } = fixture(t);
  const task = store.createTask(id, "bag");
  advance(1800001);
  assert.equal(store.task(id, task.id).state, "expired");
  fails(() => store.completeTask(id, task.id), 409);
  assert.equal(
    store.db.prepare("SELECT reserved FROM budgets").get().reserved,
    0,
  );
  assert.equal(store.task(id, task.id).state, "expired");
});

test("补贴配置变更不追改已经承诺的任务", (t) => {
  const { store, id, advance } = fixture(t);
  const task = store.createTask(id, "bag");
  store.updateSettings({ subsidyCoins: 900, bagBase: 500 });
  advance(3000);
  store.completeTask(id, task.id);
  assert.equal(store.profile(id).balance, 3700);
  advance(60000);
  const next = store.createTask(id, "bag");
  assert.equal(next.total, 1400);
  assert.equal(next.ruleVersion, 2);
});

test("预算耗尽拒绝新增，降低预算不能侵占已承诺奖励", (t) => {
  const { store, id, advance } = fixture(t);
  store.updateSettings({ dailyBudgetCoins: 100 });
  const task = store.createTask(id, "bag");
  fails(() => store.updateSettings({ dailyBudgetCoins: 99 }), 409);
  advance(3000);
  store.completeTask(id, task.id);
  advance(60000);
  fails(() => store.createTask(id, "bag"), 409);
  assert.equal(store.adminOverview().budget.spent, 100);
  assert.equal(store.profile(id).balance, 3700);
});

test("跨账户不能读取、取消或完成他人任务和计划", (t) => {
  const { store, id, advance } = fixture(t);
  const other = store.login("installation_user_two").user.id;
  const task = store.createTask(id, "bag");
  advance(3000);
  fails(() => store.task(other, task.id), 404);
  fails(() => store.cancelTask(other, task.id), 404);
  fails(() => store.completeTask(other, task.id), 404);
  const planId = store.plans(id)[0].id;
  fails(() => store.changePlan(other, planId, true), 404);
  fails(() => store.removePlan(other, planId), 404);
});

test("任务类型、每日次数和冷却由服务器控制", (t) => {
  const { store, id, advance } = fixture(t);
  fails(() => store.createTask(id, "unknown"), 400);
  fails(() => store.createTask(id, "chest"), 409);
  fails(() => store.createTask(id, "signin_bonus"), 409);
  store.checkin(id);
  store.updateSettings({ dailyAdLimit: 1 });
  const task = store.createTask(id, "signin_bonus");
  fails(() => store.createTask(id, "bag"), 409);
  advance(3000);
  store.completeTask(id, task.id);
  advance(120000);
  fails(() => store.createTask(id, "chest"), 409);
});

test("账户限制阻止新任务，但履行已创建任务；每人可独立限次", (t) => {
  const { store, id, advance } = fixture(t);
  const task = store.createTask(id, "bag");
  store.updateUser(id, {
    status: "restricted",
    dailyLimit: 1,
    reason: "测试人工复核",
  });
  advance(3000);
  store.completeTask(id, task.id);
  assert.equal(store.profile(id).balance, 3700);
  fails(() => store.checkin(id), 403);
  store.updateUser(id, {
    status: "active",
    dailyLimit: 1,
    reason: "复核完成恢复",
  });
  advance(60000);
  fails(() => store.createTask(id, "bag"), 409);
  assert.equal(
    store.adminOverview().audit.filter((a) => a.action === "user.update")
      .length,
    2,
  );
});

test("提现创建幂等，冻结和驳回只记一次账", (t) => {
  const { store, id } = fixture(t);
  const order = store.withdraw(id, 1000, "request_key_0001");
  assert.equal(store.withdraw(id, 1000, "request_key_0001").id, order.id);
  fails(() => store.withdraw(id, 2000, "request_key_0001"), 409);
  assert.equal(store.profile(id).balance, 2600);
  assert.equal(store.profile(id).frozen, 1000);
  store.reviewWithdrawal(order.id, "reject", "演示复核未通过");
  store.reviewWithdrawal(order.id, "reject", "演示复核未通过");
  assert.equal(store.profile(id).balance, 3600);
  assert.equal(store.profile(id).frozen, 0);
  assert.equal(
    store.ledger(id).filter((l) => l.type === "withdraw_return").length,
    1,
  );
});

test("审核和模拟完成具有状态约束，绝不标记真实到账", (t) => {
  const { store, id } = fixture(t);
  const order = store.withdraw(id, 1000, "request_key_0002");
  fails(() => store.reviewWithdrawal(order.id, "simulate_pay"), 409);
  store.reviewWithdrawal(order.id, "approve");
  assert.equal(store.profile(id).frozen, 1000);
  const paid = store.reviewWithdrawal(order.id, "simulate_pay");
  assert.equal(paid.state, "demo_paid");
  store.reviewWithdrawal(order.id, "simulate_pay");
  assert.equal(store.profile(id).frozen, 0);
  assert.equal(store.profile(id).paid, 1000);
  fails(() => store.reviewWithdrawal(order.id, "reject", "不允许退回"), 409);
  assert.equal(
    store.ledger(id).filter((l) => l.type === "withdraw_paid").length,
    1,
  );
});

test("提现拒绝小数、无法精确换算、低于门槛及超出余额", (t) => {
  const { store, id } = fixture(t);
  for (const coins of [1, -1000, 1000.5, 1001, Number.MAX_SAFE_INTEGER])
    fails(() => store.withdraw(id, coins, "request_key_invalid"), 400);
  fails(() => store.withdraw(id, 10000, "request_key_toobig"), 409);
  assert.equal(store.profile(id).balance, 3600);
  assert.equal(store.profile(id).frozen, 0);
});

test("正式模式拒绝开发登录、模拟奖励、模拟付款与计时工具", (t) => {
  const store = new Store({ development: false, adProvider: "disabled" });
  t.after(() => store.close());
  fails(() => store.login("installation_user_one"), 403);
  const id = store.login("wx:test_openid", false).user.id;
  assert.equal(store.profile(id).balance, 0);
  fails(() => store.createTask(id, "bag"), 503);
  fails(() => store.completeTask(id, "anything"), 403);
  fails(() => store.withdraw(id, 1000, "request_key_prod"), 503);
  fails(() => store.reviewWithdrawal("anything", "approve"), 503);
  fails(() => store.demoReady(id), 403);
  assert.equal(store.publicConfig().cashTransfersEnabled, false);
  assert.throws(() => new Store({ development: false, adProvider: "demo" }));
});

test("计划保存和修改不依赖广告，输入会校验", (t) => {
  const { store, id } = fixture(t);
  const plans = store.addPlan(id, " 整理书桌 "),
    item = plans.find((p) => p.title === "整理书桌");
  assert.ok(item);
  store.changePlan(id, item.id, true);
  assert.equal(store.plans(id).find((p) => p.id === item.id).done, 1);
  store.removePlan(id, item.id);
  assert.equal(store.plans(id).length, 3);
  fails(() => store.addPlan(id, "   "), 400);
  fails(() => store.addPlan(id, "长".repeat(61)), 400);
  fails(() => store.changePlan(id, store.plans(id)[0].id, "false"), 400);
});

test("重启保留余额、流水和会话，不重复发演示初始金币", () => {
  const directory = mkdtempSync(join(tmpdir(), "xingxiang-test-")),
    path = join(directory, "db.sqlite");
  let store;
  try {
    store = new Store({ path });
    const login = store.login("persistent_installation");
    store.checkin(login.user.id);
    store.close();
    store = new Store({ path });
    assert.equal(store.authenticate(login.token), login.user.id);
    assert.equal(store.login("persistent_installation").user.balance, 3610);
    assert.equal(
      store.ledger(login.user.id).filter((l) => l.type === "demo_seed").length,
      1,
    );
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("登录令牌有期限，后台不能修改换算比例或任意属性", (t) => {
  const { store, token, advance } = fixture(t);
  advance(8 * 86400000);
  fails(() => store.authenticate(token), 401);
  fails(() => store.updateSettings({ coinsPerYuan: 1 }), 400);
  fails(() => store.updateSettings({ subsidyCoins: -1 }), 400);
  fails(() => store.updateSettings({ chestCooldownSeconds: 1 }), 400);
});
