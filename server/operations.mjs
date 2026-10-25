import { randomUUID, createHash } from "node:crypto";
import { AppError, dayKey } from "./store.mjs";
const need = (value, message, status = 400) => {
  if (!value) throw new AppError(message, status, "OPERATION_INVALID");
};
const note = (value, min = 2, max = 200) => {
  need(
    typeof value === "string" &&
      value.trim().length >= min &&
      Array.from(value.trim()).length <= max,
    `请输入${min}—${max}字`,
  );
  return value.trim();
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
export class Operations {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS account_closures(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL,reason TEXT NOT NULL,decision TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS closure_one_pending ON account_closures(user_id) WHERE state='pending';
 CREATE TABLE IF NOT EXISTS business_entries(id TEXT PRIMARY KEY,day TEXT NOT NULL,kind TEXT NOT NULL,amount_fen INTEGER NOT NULL CHECK(amount_fen>0),reference TEXT UNIQUE NOT NULL,memo TEXT NOT NULL,voided INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
 `);
  }
  accountState(id) {
    const row = this.db
      .prepare(
        "SELECT id,state,decision,created_at,updated_at FROM account_closures WHERE user_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(id);
    return row || null;
  }
  closing(id) {
    return this.accountState(id)?.state === "pending";
  }
  logout(id, token, all = false) {
    this.db
      .prepare(
        all
          ? "DELETE FROM sessions WHERE user_id=?"
          : "DELETE FROM sessions WHERE user_id=? AND token_hash=?",
      )
      .run(...(all ? [id] : [id, hash(token)]));
    this.store.roomContent.pause(id);
    return { loggedOut: true };
  }
  rename(id, name) {
    name = note(name, 1, 16);
    return this.store.transaction(() => {
      need(this.store.user(id).status !== "closed", "账户已注销", 403);
      this.db.prepare("UPDATE users SET name=? WHERE id=?").run(name, id);
      this.store.audit("profile.rename", id);
      return this.store.profile(id);
    });
  }
  history(id, type = "ledger", cursor = "") {
    need(["ledger", "withdrawals", "tasks"].includes(type), "记录类型无效");
    need(
      cursor === "" || /^[1-9][0-9]{0,14}$/.test(String(cursor)),
      "分页游标无效",
    );
    const table = type === "tasks" ? "tasks" : type,
      rows = this.db
        .prepare(
          `SELECT rowid AS cursor_id,* FROM ${table} WHERE user_id=? AND rowid<? ORDER BY rowid DESC LIMIT 51`,
        )
        .all(id, cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER),
      more = rows.length > 50,
      page = rows.slice(0, 50);
    return {
      items: page.map((r) => {
        const { cursor_id, ...value } = r;
        return type === "tasks" ? this.store.taskView(value) : value;
      }),
      nextCursor: more ? String(page.at(-1).cursor_id) : null,
    };
  }
  exportData(id) {
    return {
      generatedAt: this.store.now(),
      scope:
        "本账户最近100条各类记录；更多记录可通过记录页分页读取。无微信openid、会话或密钥。",
      profile: this.store.profile(id),
      ledger: this.store.ledger(id),
      withdrawals: this.store.withdrawals(id),
      tasks: this.db
        .prepare(
          "SELECT * FROM tasks WHERE user_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(id)
        .map((t) => this.store.taskView(t)),
      support: this.store.supportList(id),
      activity: this.db
        .prepare(
          "SELECT actor_name,kind,content,created_at FROM room_posts WHERE user_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(id),
    };
  }
  requestClosure(id, data) {
    need(
      data?.discardUnclaimed === true,
      "请确认放弃尚未领取的开发奖励；已入账余额不会被扣除",
    );
    const reason = note(data.reason, 2, 200);
    this.store.pruneExpired();
    return this.store.transaction(() => {
      const old = this.accountState(id);
      if (old?.state === "pending") return old;
      const u = this.store.user(id);
      need(
        u.balance === 0 && u.frozen === 0,
        "请先处理已入账余额和冻结申请，再申请注销",
        409,
      );
      need(
        !this.store.profile(id).pendingTask,
        "请先完成或取消未完成任务",
        409,
      );
      const now = this.store.now(),
        key = randomUUID();
      this.db
        .prepare(
          "INSERT INTO account_closures VALUES(?,?,'pending',?,NULL,?,?)",
        )
        .run(key, id, reason, now, now);
      this.store.roomContent.pause(id);
      this.store.audit("account.closure.request", id, {
        requestId: key,
        discardUnclaimed: true,
      });
      return this.accountState(id);
    });
  }
  closureList() {
    return this.db
      .prepare(
        "SELECT c.*,u.name FROM account_closures c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 100",
      )
      .all();
  }
  reviewClosure(key, action, reason) {
    need(["approve", "reject"].includes(action), "注销处理操作无效");
    reason = note(reason);
    this.store.pruneExpired();
    return this.store.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM account_closures WHERE id=?")
        .get(key);
      need(row, "注销申请不存在", 404);
      const target = action === "approve" ? "approved" : "rejected";
      if (row.state === target) return { state: target };
      need(row.state === "pending", "申请已处理", 409);
      if (action === "approve") {
        const u = this.store.user(row.user_id);
        need(
          !u.balance && !u.frozen && !this.store.profile(u.id).pendingTask,
          "账户仍有余额、冻结款或任务，不能注销",
          409,
        );
        const allocations = this.db
          .prepare(
            "SELECT day,SUM(amount) AS amount FROM bank_allocations WHERE user_id=? GROUP BY day",
          )
          .all(u.id);
        for (const a of allocations)
          this.db
            .prepare("UPDATE budgets SET reserved=reserved-? WHERE day=?")
            .run(a.amount, a.day);
        this.db
          .prepare("DELETE FROM bank_allocations WHERE user_id=?")
          .run(u.id);
        this.db
          .prepare("UPDATE banks SET coins=0,locked_task=NULL WHERE user_id=?")
          .run(u.id);
        this.db
          .prepare(
            "UPDATE users SET identity=?,name='已注销用户',status='closed' WHERE id=?",
          )
          .run("closed:" + u.id, u.id);
        this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
        this.db.prepare("DELETE FROM room_posts WHERE user_id=?").run(u.id);
        this.db.prepare("DELETE FROM room_clocks WHERE user_id=?").run(u.id);
        this.db
          .prepare(
            "UPDATE support SET message='账号已注销，非账务文本已移除',reply=NULL WHERE user_id=?",
          )
          .run(u.id);
      }
      this.db
        .prepare(
          "UPDATE account_closures SET state=?,decision=?,updated_at=? WHERE id=?",
        )
        .run(target, reason, this.store.now(), key);
      this.store.audit("account.closure." + action, row.user_id, {
        requestId: key,
        reason,
        financialRecordsRetained: true,
      });
      return { state: target };
    });
  }
  users(query = "", page = 1) {
    need(typeof query === "string" && query.length <= 100, "查询内容过长");
    need(Number.isSafeInteger(page) && page >= 1 && page <= 10000, "页码无效");
    const escaped = query.replace(/[\\%_]/g, "\\$&"),
      pattern = "%" + escaped + "%",
      where = "WHERE name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'";
    return {
      items: this.db
        .prepare(
          "SELECT id,name,status,balance,frozen,paid,daily_limit,created_at FROM users " +
            where +
            " ORDER BY created_at DESC,id LIMIT 50 OFFSET ?",
        )
        .all(pattern, pattern, (page - 1) * 50),
      total: this.db
        .prepare("SELECT COUNT(*) AS n FROM users " + where)
        .get(pattern, pattern).n,
      page,
    };
  }
  userDetail(id) {
    const { identity, ...user } = this.store.user(id);
    return {
      user,
      ledger: this.store.ledger(id),
      tasks: this.history(id, "tasks"),
      withdrawals: this.store.withdrawals(id),
      support: this.store.supportList(id),
      closure: this.accountState(id),
    };
  }
  addBusiness(data) {
    need(
      data &&
        [
          "ad_settled",
          "content",
          "infrastructure",
          "staff",
          "acquisition",
          "fulfillment",
          "other",
        ].includes(data.kind),
      "收支类型无效",
    );
    need(
      Number.isSafeInteger(data.amountFen) &&
        data.amountFen > 0 &&
        data.amountFen <= 1000000000,
      "金额需1—1000000000分",
    );
    need(
      typeof data.day === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(data.day) &&
        Number.isFinite(Date.parse(data.day + "T12:00:00+08:00")) &&
        dayKey(Date.parse(data.day + "T12:00:00+08:00")) === data.day,
      "业务日期无效",
    );
    const reference = note(data.reference, 2, 100),
      memo = note(data.memo, 2, 200);
    return this.store.transaction(() => {
      const previous = this.db
        .prepare("SELECT * FROM business_entries WHERE reference=?")
        .get(reference);
      if (previous) {
        need(
          previous.day === data.day &&
            previous.kind === data.kind &&
            previous.amount_fen === data.amountFen &&
            previous.memo === memo,
          "同一账单编号已存在且内容不同",
          409,
        );
        return previous;
      }
      const key = randomUUID();
      this.db
        .prepare("INSERT INTO business_entries VALUES(?,?,?,?,?,?,0,?)")
        .run(
          key,
          data.day,
          data.kind,
          data.amountFen,
          reference,
          memo,
          this.store.now(),
        );
      this.store.audit("business.record", key, {
        kind: data.kind,
        amountFen: data.amountFen,
        reference,
      });
      return this.db
        .prepare("SELECT * FROM business_entries WHERE id=?")
        .get(key);
    });
  }
  voidBusiness(id, reason) {
    reason = note(reason);
    return this.store.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM business_entries WHERE id=?")
        .get(id);
      need(row, "收支记录不存在", 404);
      if (!row.voided) {
        this.db
          .prepare("UPDATE business_entries SET voided=1 WHERE id=?")
          .run(id);
        this.store.audit("business.void", id, { reason });
      }
      return { voided: true };
    });
  }
  report(days = 7) {
    need(
      Number.isSafeInteger(days) && days >= 1 && days <= 90,
      "报表范围需1—90天",
    );
    const today = dayKey(this.store.now()),
      start = Date.parse(today + "T00:00:00+08:00") - (days - 1) * 86400000,
      rows = [];
    for (let i = 0; i < days; i++) {
      const from = start + i * 86400000,
        to = from + 86400000,
        day = dayKey(from),
        tasks = this.db
          .prepare(
            "SELECT COUNT(*) AS completed,COUNT(DISTINCT user_id) AS taskUsers,COALESCE(SUM(base),0) AS baseCoins,COALESCE(SUM(subsidy),0) AS subsidyCoins FROM tasks WHERE state='rewarded' AND completed_at>=? AND completed_at<?",
          )
          .get(from, to),
        users = this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE created_at>=? AND created_at<?",
          )
          .get(from, to).n,
        money = this.db
          .prepare(
            "SELECT COALESCE(SUM(CASE WHEN kind='ad_settled' THEN amount_fen ELSE 0 END),0) AS revenueFen,COALESCE(SUM(CASE WHEN kind!='ad_settled' THEN amount_fen ELSE 0 END),0) AS expenseFen FROM business_entries WHERE day=? AND voided=0",
          )
          .get(day);
      rows.push({
        day,
        newAccounts: users,
        ...tasks,
        ...money,
        recordedNetFen: money.revenueFen - money.expenseFen,
      });
    }
    return {
      mode: this.store.development ? "development" : "production",
      notice:
        "广告最终结算收入与现金成本由运营凭账单人工录入，未对接广告收入接口；开发金币不是实际现金成本或收入。",
      rows,
      entries: this.db
        .prepare(
          "SELECT * FROM business_entries WHERE day>=? ORDER BY created_at DESC,rowid DESC LIMIT 200",
        )
        .all(dayKey(start)),
    };
  }
  reconcile() {
    this.store.pruneExpired();
    return this.store.transaction(() => {
      const issues = [],
        push = (type, id, expected, actual) => {
          if (expected !== actual) issues.push({ type, id, expected, actual });
        };
      for (const u of this.db
        .prepare("SELECT id,balance,frozen,paid FROM users")
        .all()) {
        const sum = this.db
          .prepare(
            "SELECT COALESCE(SUM(available_delta),0) AS a,COALESCE(SUM(frozen_delta),0) AS f,COALESCE(SUM(paid_delta),0) AS p FROM ledger WHERE user_id=?",
          )
          .get(u.id);
        push("account.balance", u.id, sum.a, u.balance);
        push("account.frozen", u.id, sum.f, u.frozen);
        push("account.paid", u.id, sum.p, u.paid);
        const orders = this.db
          .prepare(
            "SELECT COALESCE(SUM(CASE WHEN state IN ('pending_review','approved') THEN coins ELSE 0 END),0) AS frozen,COALESCE(SUM(CASE WHEN state='demo_paid' THEN coins ELSE 0 END),0) AS paid FROM withdrawals WHERE user_id=?",
          )
          .get(u.id);
        push("withdrawal.frozen", u.id, orders.frozen, u.frozen);
        push("withdrawal.paid", u.id, orders.paid, u.paid);
      }
      for (const b of this.db.prepare("SELECT * FROM banks").all()) {
        const allocated = this.db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM bank_allocations WHERE user_id=? AND kind=? AND generation=?",
          )
          .get(b.user_id, b.kind, b.generation).n;
        push("bank.allocation", b.user_id + ":" + b.kind, b.coins, allocated);
        if (b.locked_task) {
          const t = this.db
            .prepare(
              "SELECT * FROM tasks WHERE id=? AND user_id=? AND state='pending'",
            )
            .get(b.locked_task, b.user_id);
          if (!t)
            issues.push({
              type: "bank.lock",
              id: b.locked_task,
              expected: "pending task",
              actual: "missing",
            });
        }
      }
      for (const b of this.db.prepare("SELECT * FROM budgets").all()) {
        const bank = this.db
            .prepare(
              "SELECT COALESCE(SUM(amount),0) AS n FROM bank_allocations WHERE day=?",
            )
            .get(b.day).n,
          pending = this.db
            .prepare(
              "SELECT COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM bank_tasks l WHERE l.task_id=t.id) THEN t.subsidy ELSE t.base+t.subsidy END),0) AS n FROM tasks t WHERE t.day=? AND t.state='pending'",
            )
            .get(b.day).n;
        push("budget.reserved", b.day, bank + pending, b.reserved);
      }
      const actual = this.db
          .prepare("SELECT COALESCE(SUM(spent),0) AS n FROM budgets")
          .get().n,
        expected = this.db
          .prepare(
            "SELECT COALESCE(SUM(available_delta),0) AS n FROM ledger WHERE type IN ('reward','subsidy','checkin')",
          )
          .get().n;
      push("budget.spent.total", "all", expected, actual);
      return {
        ok: issues.length === 0,
        checkedAt: this.store.now(),
        issues,
        scope:
          "账户/流水、冻结/已付、奖励池预留、每日预算预留及总支出；不含微信渠道对账",
      };
    });
  }
}
