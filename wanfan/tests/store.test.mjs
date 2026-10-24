import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DinnerStore, ErrorResponse, day } from "../server/store.mjs";
const fails = (fn, status) =>
  assert.throws(fn, (e) => e instanceof ErrorResponse && e.status === status);
function fixture(t) {
  let now = Date.parse("2026-10-25T10:00:00Z");
  const s = new DinnerStore({ now: () => now });
  t.after(() => s.close());
  const login = s.login("dinner_test_installation");
  return {
    s,
    u: login.user.id,
    token: login.token,
    advance: (ms) => {
      now += ms;
    },
    setTime: (ms) => {
      now = Date.parse(ms);
    },
  };
}
test("新账户没有虚假食材、菜单、签到、权益或完成记录", (t) => {
  const { s, u } = fixture(t),
    d = s.dashboard(u);
  assert.equal(d.pantry.length, 0);
  assert.equal(d.plans.length, 0);
  assert.equal(d.user.streak, 0);
  assert.equal(d.user.mealsCompleted, 0);
  assert.equal(d.user.entitlement.active, false);
  assert.ok(d.recommendations.length > 0);
  assert.equal(s.config().adStatus, "disabled");
  assert.equal(s.config().cashStatus, "disabled");
});
test("推荐严格遵守时间及蛋奶素食偏好，所有做法免费可读取", (t) => {
  const { s, u } = fixture(t);
  s.preferences(u, { servings: 3, maxMinutes: 15, vegetarian: true });
  const rs = s.recommendations(u);
  assert.ok(rs.length > 0);
  assert.ok(
    rs.every((r) => r.vegetarian && r.minutes <= 15 && r.servings === 3),
  );
  for (const r of rs) assert.ok(s.recipe(u, r.id).steps.length >= 4);
  assert.notDeepEqual(
    s.rotate(u).map((r) => r.id),
    rs.map((r) => r.id),
  );
});
test("人数换算、库存抵扣和采购进度按实际缺料计算", (t) => {
  const { s, u } = fixture(t);
  s.putPantry(u, { ingredientId: "tomato", amount: 1, expires: null });
  s.plan(u, { recipeId: "tomato-egg", servings: 3 });
  const list = s.shopping(u);
  assert.equal(list.find((i) => i.id === "tomato").missing, 2);
  assert.equal(list.find((i) => i.id === "egg").missing, 4.5);
  s.purchase(u, "tomato", true);
  assert.equal(s.shopping(u).find((i) => i.id === "tomato").checked, true);
  assert.equal(s.pantry(u)[0].amount, 1, "采购勾选不能假定更新实物库存");
});
test("已过自设日期的库存不抵扣，非法日历日期会被拒绝", (t) => {
  const { s, u } = fixture(t);
  s.putPantry(u, { ingredientId: "tomato", amount: 10, expires: "2026-10-24" });
  assert.equal(s.pantry(u)[0].expired, true);
  assert.equal(
    s.recipe(u, "tomato-egg").ingredients.find((i) => i.id === "tomato")
      .missing,
    2,
  );
  fails(
    () =>
      s.putPantry(u, { ingredientId: "egg", amount: 1, expires: "2026-02-31" }),
    400,
  );
  fails(
    () =>
      s.putPantry(u, { ingredientId: "egg", amount: 1, expires: "not-date" }),
    400,
  );
});
test("购物清单聚合同日菜单，新增需求后已购标记重新提示", (t) => {
  const { s, u } = fixture(t);
  s.plan(u, { recipeId: "tomato-egg", servings: 2 });
  s.purchase(u, "egg", true);
  s.plan(u, { recipeId: "shrimp-egg", servings: 2 });
  const egg = s.shopping(u).find((i) => i.id === "egg");
  assert.equal(egg.missing, 6);
  assert.equal(egg.checked, false);
});
test("同日同菜谱重复选择只创建一个计划", (t) => {
  const { s, u } = fixture(t);
  const a = s.plan(u, { recipeId: "tomato-egg", servings: 2 }),
    b = s.plan(u, { recipeId: "tomato-egg", servings: 2 });
  assert.equal(a.id, b.id);
  assert.equal(s.plans(u).length, 1);
  fails(() => s.plan(u, { recipeId: "tomato-egg", servings: 3 }), 409);
  assert.equal(s.plans(u)[0].servings, 2);
});
test("完成菜单幂等扣库存，记录和核心事件只保留一次", (t) => {
  const { s, u } = fixture(t);
  s.putPantry(u, { ingredientId: "tomato", amount: 4, expires: null });
  s.putPantry(u, { ingredientId: "egg", amount: 1, expires: null });
  const p = s.plan(u, { recipeId: "tomato-egg", servings: 2 });
  assert.equal(s.complete(u, p.id).alreadyCompleted, false);
  assert.equal(s.complete(u, p.id).alreadyCompleted, true);
  assert.equal(s.pantry(u).find((i) => i.id === "tomato").amount, 2);
  assert.equal(
    s.pantry(u).some((i) => i.id === "egg"),
    false,
  );
  assert.equal(s.journal(u).history.length, 1);
  assert.equal(s.shopping(u).length, 0);
  assert.equal(s.overview().stats.cooks, 1);
});
test("不能越权完成、移除他人菜单，也不能提前完成未来菜单", (t) => {
  const { s, u } = fixture(t),
    other = s.login("other_dinner_installation").user.id;
  const p = s.plan(u, { recipeId: "tomato-egg", servings: 2 });
  fails(() => s.complete(other, p.id), 404);
  fails(() => s.removePlan(other, p.id), 404);
  const future = s.plan(u, {
    recipeId: "tomato-egg",
    servings: 2,
    date: "2026-10-26",
  });
  fails(() => s.complete(u, future.id), 409);
  fails(
    () =>
      s.plan(u, { recipeId: "tomato-egg", servings: 2, date: "2026-11-30" }),
    400,
  );
});
test("库存及偏好输入校验，不接受负数或隐式字符串", (t) => {
  const { s, u } = fixture(t);
  for (const amount of [-1, 0, NaN, Infinity, "2", 1.001])
    fails(
      () => s.putPantry(u, { ingredientId: "egg", amount, expires: null }),
      400,
    );
  fails(
    () => s.putPantry(u, { ingredientId: "unknown", amount: 1, expires: null }),
    400,
  );
  fails(
    () => s.preferences(u, { servings: 7, maxMinutes: 15, vegetarian: false }),
    400,
  );
  fails(
    () => s.preferences(u, { servings: 2, maxMinutes: 1, vegetarian: false }),
    400,
  );
});
test("北京时间跨日签到、断签和七日日历基于真实记录", (t) => {
  const { s, u, setTime } = fixture(t);
  setTime("2026-10-25T15:59:59Z");
  assert.equal(s.checkin(u).alreadyClaimed, false);
  assert.equal(s.checkin(u).alreadyClaimed, true);
  setTime("2026-10-25T16:00:00Z");
  assert.equal(day(Date.parse("2026-10-25T16:00:00Z")), "2026-10-26");
  assert.equal(s.profile(u).signedToday, false);
  s.checkin(u);
  assert.equal(s.profile(u).streak, 2);
  assert.equal(s.profile(u).week.at(-1).dayNumber, "26");
  setTime("2026-10-28T02:00:00Z");
  assert.equal(s.profile(u).streak, 0);
  s.checkin(u);
  assert.equal(s.profile(u).streak, 1);
});
test("收藏属于本人，删除不影响其他用户", (t) => {
  const { s, u } = fixture(t),
    other = s.login("favorite_other_user").user.id;
  s.favorite(u, "tomato-egg", true);
  s.favorite(u, "tomato-egg", true);
  assert.equal(s.journal(u).favorites.length, 1);
  assert.equal(s.journal(other).favorites.length, 0);
  s.favorite(u, "tomato-egg", false);
  assert.equal(s.journal(u).favorites.length, 0);
});
test("周计划需权益，管理员内部授予幂等并审计", (t) => {
  const { s, u } = fixture(t);
  fails(() => s.generateWeek(u), 403);
  const a = s.grant(u),
    b = s.grant(u);
  assert.equal(a.id, b.id);
  assert.equal(a.source, "internal_admin");
  assert.equal(s.journal(u).grants.length, 1);
  const w = s.generateWeek(u);
  assert.equal(w.days.length, 7);
  assert.ok(w.ingredients.length > 0);
  assert.equal(s.latestWeek(u).id, w.id);
  assert.equal(
    s.overview().audit.filter((x) => x.action === "entitlement.internal_grant")
      .length,
    1,
  );
});
test("权益到期不删旧成果，但不能生成新周计划", (t) => {
  const { s, u, advance } = fixture(t);
  s.grant(u);
  const w = s.generateWeek(u);
  advance(86400001);
  assert.equal(s.profile(u).entitlement.active, false);
  fails(() => s.generateWeek(u), 403);
  assert.equal(s.latestWeek(u).id, w.id);
});
test("周计划有实际生成上限，少于7道时不虚构菜谱", (t) => {
  const { s, u } = fixture(t);
  s.preferences(u, { servings: 1, maxMinutes: 15, vegetarian: true });
  s.grant(u);
  for (let i = 0; i < 10; i++) assert.equal(s.generateWeek(u).days.length, 7);
  fails(() => s.generateWeek(u), 409);
  const w = s.latestWeek(u);
  assert.ok(w.days.every((r) => r.minutes <= 15));
  assert.match(w.note, /重复/);
});
test("内部奖励全局日额度100位，不冒充平台频控", (t) => {
  const { s, u } = fixture(t);
  s.grant(u);
  for (let n = 1; n < 100; n++)
    s.grant(s.login("grant_user_" + String(n).padStart(8, "0")).user.id);
  const last = s.login("grant_user_last_100").user.id;
  fails(() => s.grant(last), 409);
  assert.equal(s.profile(last).entitlement.active, false);
});
test("正式模式关闭开发身份与测试授予，保留免费工具", (t) => {
  const s = new DinnerStore({ development: false });
  t.after(() => s.close());
  fails(() => s.login("production_demo_user"), 403);
  const u = s.login("wx:actual_test_user", false).user.id;
  assert.ok(s.dashboard(u).recommendations.length);
  fails(() => s.grant(u), 403);
  fails(() => s.generateWeek(u), 403);
});
test("内容停用后不再推荐或新建计划", (t) => {
  const { s, u } = fixture(t);
  s.setRecipe("tomato-egg", false);
  assert.equal(
    s.recommendations(u).some((r) => r.id === "tomato-egg"),
    false,
  );
  fails(() => s.recipe(u, "tomato-egg"), 404);
  fails(() => s.plan(u, { recipeId: "tomato-egg", servings: 2 }), 404);
  s.setRecipe("tomato-egg", true);
  assert.equal(s.recipe(u, "tomato-egg").id, "tomato-egg");
});
test("反馈可实际回复，日上限防止重复刷取", (t) => {
  const { s, u } = fixture(t);
  const f = s.feedback(u, "希望有更多蔬菜做法");
  s.reply(f.id, "已记录，后续人工校对后补充。");
  assert.equal(s.journal(u).feedback[0].state, "resolved");
  assert.match(s.journal(u).feedback[0].reply, /已记录/);
  for (let n = 0; n < 4; n++) s.feedback(u, "另一条具体反馈" + n);
  fails(() => s.feedback(u, "超出反馈上限"), 429);
});
test("分析没有样本就不填留存，访问去重与跨日回访准确", (t) => {
  const { s, u, advance } = fixture(t);
  assert.equal(s.overview().cohorts[0].rate, null);
  s.dashboard(u);
  s.dashboard(u);
  assert.equal(s.overview().stats.activeUsers, 1);
  advance(86400000);
  s.dashboard(u);
  const c = s.overview().cohorts.find((c) => c.days === 1);
  assert.equal(c.cohortSize, 1);
  assert.equal(c.retained, 1);
  advance(6 * 86400000);
  s.dashboard(u);
  assert.equal(s.overview().cohorts.find((c) => c.days === 7).rate, 1);
});
test("删除账户移除会话、计划、反馈、事件和权益", (t) => {
  const { s, u, token } = fixture(t);
  s.dashboard(u);
  s.plan(u, { recipeId: "tomato-egg", servings: 2 });
  s.checkin(u);
  s.feedback(u, "测试删除记录");
  s.grant(u);
  s.deleteAccount(u);
  fails(() => s.auth(token), 401);
  for (const table of [
    "users",
    "sessions",
    "plans",
    "feedback",
    "events",
    "grants",
  ])
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0);
  assert.equal(s.activeRecipes().length, 12);
});
test("SQLite重启后保留真实进度，不引入旧金币数据", () => {
  const root = mkdtempSync(join(tmpdir(), "wanfan-db-"));
  let s;
  try {
    const path = join(root, "dinner.sqlite");
    s = new DinnerStore({ path });
    const a = s.login("persistent_dinner_user");
    s.putPantry(a.user.id, { ingredientId: "egg", amount: 6, expires: null });
    s.plan(a.user.id, { recipeId: "tomato-egg", servings: 2 });
    s.close();
    s = new DinnerStore({ path });
    assert.equal(s.auth(a.token), a.user.id);
    assert.equal(s.pantry(a.user.id)[0].amount, 6);
    assert.equal(s.plans(a.user.id).length, 1);
    assert.equal("balance" in s.profile(a.user.id), false);
    const legacyPath = join(root, "legacy.sqlite");
    let legacy = new DatabaseSync(legacyPath);
    legacy.exec(
      "CREATE TABLE users(id TEXT,balance INTEGER);INSERT INTO users VALUES('old-user',8888)",
    );
    legacy.close();
    assert.throws(() => new DinnerStore({ path: legacyPath }), /独立数据库/);
    legacy = new DatabaseSync(legacyPath);
    assert.equal(
      legacy.prepare("SELECT balance FROM users").get().balance,
      8888,
    );
    assert.equal(
      legacy
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='pantry'")
        .get().n,
      0,
    );
    legacy.close();
  } finally {
    s?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
