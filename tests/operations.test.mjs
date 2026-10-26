import test from "node:test";
import assert from "node:assert/strict";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
function setup(t) {
  let now = Date.parse("2026-10-25T01:00:00Z");
  const s = new YuanxiangStore({ now: () => now, draw: () => 0 });
  t.after(() => s.close());
  const auth = s.login("operations_fixture");
  return {
    s,
    u: auth.user.id,
    token: auth.token,
    advance(ms) {
      now += ms;
    },
  };
}
function earn(s, u, advance, kind = "signin") {
  const task = s.createTask(u, kind);
  advance(3100);
  s.completeTask(u, task.id);
  return task;
}
test("对账覆盖跨日叠包、锁金额、取消、发奖、冻结和退款", (t) => {
  const { s, u, advance } = setup(t);
  assert.equal(s.operations.reconcile().ok, true);
  advance(120000);
  s.group(u);
  assert.equal(s.operations.reconcile().ok, true);
  const p = s.createTask(u, "redpacket");
  assert.equal(s.operations.reconcile().ok, true);
  s.cancelTask(u, p.id);
  assert.equal(s.operations.reconcile().ok, true);
  earn(s, u, advance);
  earn(s, u, advance, "redpacket");
  const order = s.withdraw(u, 1000, "ops_withdraw_unique");
  assert.equal(s.operations.reconcile().ok, true);
  s.reviewWithdrawal(order.id, "reject", "对账开发测试");
  assert.equal(s.operations.reconcile().ok, true);
  advance(86400000);
  s.group(u);
  assert.equal(s.operations.reconcile().ok, true);
});
test("对账能发现余额、预留及锁任务损坏，不自动改账掩盖差异", (t) => {
  const { s, u, advance } = setup(t);
  advance(120000);
  s.group(u);
  s.db.prepare("UPDATE users SET balance=17 WHERE id=?").run(u);
  s.db.prepare("UPDATE budgets SET reserved=reserved+5").run();
  s.db
    .prepare(
      "UPDATE banks SET locked_task='missing' WHERE user_id=? AND kind='redpacket'",
    )
    .run(u);
  const r = s.operations.reconcile();
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.type === "account.balance"));
  assert.ok(r.issues.some((i) => i.type === "budget.reserved"));
  assert.ok(r.issues.some((i) => i.type === "bank.lock"));
  assert.equal(s.profile(u).balance, 17);
});
test("手工结算和费用精确以分记账、重复提交幂等，冲销保留记录及审计", (t) => {
  const { s } = setup(t),
    entry = {
      day: "2026-10-25",
      kind: "ad_settled",
      amountFen: 12345,
      reference: "平台结算单001",
      memo: "凭平台最终账单录入",
    };
  const a = s.operations.addBusiness(entry);
  assert.equal(s.operations.addBusiness(entry).id, a.id);
  s.operations.addBusiness({
    ...entry,
    kind: "infrastructure",
    amountFen: 2345,
    reference: "主机费用001",
  });
  let row = s.operations.report(1).rows[0];
  assert.equal(row.recordedNetFen, 10000);
  assert.throws(
    () => s.operations.addBusiness({ ...entry, amountFen: 99 }),
    (e) => e.status === 409,
  );
  s.operations.voidBusiness(a.id, "录入错误需冲销");
  row = s.operations.report(1).rows[0];
  assert.equal(row.revenueFen, 0);
  assert.equal(s.operations.report(1).entries.length, 2);
  assert.ok(s.adminOverview().audit.some((a) => a.action === "business.void"));
});
test("经营报表区分人工现金收支与开发金币，无展示或权重收入推算", (t) => {
  const { s, u, advance } = setup(t);
  earn(s, u, advance);
  assert.equal(s.publicConfig().version, s.settings().version);
  assert.equal(s.publicConfig().appVersion, "0.5.0");
  const report = s.operations.report(1),
    row = report.rows[0];
  assert.equal(row.completed, 1);
  assert.equal(row.taskUsers, 1);
  assert.equal(row.baseCoins, 600);
  assert.equal(row.subsidyCoins, 20);
  assert.equal(row.revenueFen, 0);
  assert.match(report.notice, /人工录入/);
  assert.throws(() => s.operations.report(91));
  for (const day of ["2026-99-01", "2026-02-30", "xxx"])
    assert.throws(() =>
      s.operations.addBusiness({
        day,
        kind: "ad_settled",
        amountFen: 10,
        reference: "bad-ref",
        memo: "无效日期",
      }),
    );
});
test("用户昵称可改、搜索分页可查询、不会返回微信身份或会话", (t) => {
  const { s, u } = setup(t);
  s.operations.rename(u, "清禾");
  const found = s.operations.users("清禾");
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, u);
  assert.equal(s.operations.users("%").total, 0);
  assert.equal("identity" in s.operations.userDetail(u).user, false);
  assert.throws(() => s.operations.rename(u, "a".repeat(17)));
});
test("历史分页不重复、不串号，导出隐藏待开奖福袋结果与身份密钥", (t) => {
  const { s, u } = setup(t);
  for (let i = 0; i < 121; i++)
    s.entry(u, "ops-entry-" + i, "fixture", "分页记录", 1);
  const first = s.operations.history(u),
    second = s.operations.history(u, "ledger", first.nextCursor),
    third = s.operations.history(u, "ledger", second.nextCursor);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 50);
  assert.equal(third.items.length, 21);
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((i) => i.id))
      .size,
    121,
  );
  const other = s.login("operations_other").user.id;
  assert.equal(s.operations.history(other).items.length, 0);
  s.createTask(u, "bag");
  const data = s.operations.exportData(u);
  assert.equal("base" in data.tasks[0], false);
  assert.doesNotMatch(
    JSON.stringify(data),
    /demo:operations_fixture|token_hash|session_key/,
  );
});
test("退出单会话和所有会话由服务器撤销，账户数据保留", (t) => {
  const { s, u, token } = setup(t),
    second = s.login("operations_fixture");
  s.operations.logout(u, token);
  assert.throws(
    () => s.authenticate(token),
    (e) => e.status === 401,
  );
  assert.equal(s.authenticate(second.token), u);
  s.operations.logout(u, second.token, true);
  assert.throws(
    () => s.authenticate(second.token),
    (e) => e.status === 401,
  );
  assert.equal(s.profile(u).balance, 0);
});
test("零余额注销申请暂停新任务，拒绝可恢复并留痕", (t) => {
  const { s, u } = setup(t);
  const request = s.operations.requestClosure(u, {
    reason: "停止使用开发账户",
    discardUnclaimed: true,
  });
  assert.equal(request.state, "pending");
  assert.equal(
    s.operations.requestClosure(u, {
      reason: "停止使用开发账户",
      discardUnclaimed: true,
    }).id,
    request.id,
  );
  assert.throws(() => s.createTask(u, "signin"), /注销申请/);
  s.operations.reviewClosure(request.id, "reject", "需要补充信息");
  assert.equal(s.profile(u).closureRequest.state, "rejected");
  assert.ok(s.createTask(u, "signin"));
});
test("注销审核清除登录关联和文本，释放未领预算，不破坏账务", (t) => {
  const { s, u, token, advance } = setup(t);
  advance(120000);
  s.group(u);
  s.support(u, "测试文本请清除");
  const request = s.operations.requestClosure(u, {
    reason: "申请注销测试账户",
    discardUnclaimed: true,
  });
  const before = s.profile(u).balance;
  s.operations.reviewClosure(request.id, "approve", "已核对无余额冻结与任务");
  assert.equal(s.profile(u).balance, before);
  assert.equal(s.user(u).identity, "closed:" + u);
  assert.equal(s.user(u).status, "closed");
  assert.equal(s.group(u).banks[0].coins, 0);
  assert.throws(
    () => s.authenticate(token),
    (e) => e.status === 401,
  );
  assert.match(s.supportList(u)[0].message, /已注销/);
  assert.equal(s.operations.reconcile().ok, true);
  assert.throws(() =>
    s.updateUser(u, { status: "active", dailyLimit: null, reason: "尝试恢复" }),
  );
});
test("有已入账余额、冻结款或待完成任务时不允许注销", (t) => {
  const { s, u, advance } = setup(t);
  const data = { reason: "停止使用测试账户", discardUnclaimed: true };
  s.createTask(u, "signin");
  assert.throws(() => s.operations.requestClosure(u, data), /任务/);
  advance(3100);
  s.completeTask(u, s.profile(u).pendingTask.id);
  assert.throws(() => s.operations.requestClosure(u, data), /余额/);
  assert.throws(
    () => s.operations.requestClosure(u, { reason: "没有确认" }),
    /确认/,
  );
});
test("新操作HTTP受用户和管理员权限保护，带请求追踪编号", async (t) => {
  const { s, u, token } = setup(t),
    admin = "ops_admin_".repeat(5),
    { server } = createYuanxiangApp({ store: s, adminToken: admin });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;
  const req = async (path, method = "GET", data, auth = token) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + auth,
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.ok(r.headers.get("x-request-id"));
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await req("/api/admin/reconciliation")).status, 401);
  assert.equal(
    (await req("/api/admin/reconciliation", "GET", null, admin)).data.ok,
    true,
  );
  assert.equal(
    (await req("/api/profile", "PUT", { name: "接口昵称" })).data.name,
    "接口昵称",
  );
  assert.equal(
    (await req("/api/admin/users?q=接口", "GET", null, admin)).data.total,
    1,
  );
  assert.equal((await req("/api/account/export")).data.profile.id, u);
  assert.equal(
    (await req("/api/auth/logout", "POST", { all: true })).status,
    200,
  );
  assert.equal((await req("/api/me")).status, 401);
});
