import { Store, AppError, dayKey } from "./store.mjs";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { randomUUID, randomBytes, randomInt, createHash } from "node:crypto";
import { buildRoomMessages } from "./room-view.mjs";
import { RoomContent } from "./room-content.mjs";
const need = (v, m, status = 400, code = "INVALID_REQUEST") => {
  if (!v) throw new AppError(m, status, code);
};
const uuid = () => randomUUID();
const hash = (s) => createHash("sha256").update(s).digest("hex");
const extra = {
  dailyAdLimit: 30,
  dailyBudgetCoins: 1000000,
  checkinCoins: 0,
  signinBase: 600,
  subsidyCoins: 20,
  packetIncrement: 390,
  packetCap: 8888,
  packetIntervalSeconds: 120,
  signinLimit: 1,
  redpacketLimit: 20,
  treasureLimit: 20,
  bagLimit: 10,
  bagCooldownSeconds: 60,
  prize80Weight: 60,
  prize120Weight: 25,
  prize200Weight: 12,
  prize500Weight: 3,
  adPreviewEnabled: 1,
  nativePreviewDelaySeconds: 15,
  nativePreviewIntervalSeconds: 90,
  bannerPreviewDelaySeconds: 45,
  bannerPreviewIntervalSeconds: 120,
  adPreviewDurationSeconds: 20,
  adPreviewCloseCooldownSeconds: 120,
  adPreviewSessionLimit: 6,
  adPreviewDailyLimit: 20,
};
const names = {
  signin: "每日签到",
  redpacket: "群红包",
  treasure: "群宝箱",
  bag: "幸运福袋",
};
export class YuanxiangStore extends Store {
  constructor(options = {}) {
    const path = options.path || ":memory:";
    if (path !== ":memory:" && existsSync(path)) {
      const read = new DatabaseSync(path, { readOnly: true });
      let foreign;
      try {
        const count = read
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'")
          .get().n;
        foreign =
          count > 0 &&
          !read
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='yuanxiang_meta'",
            )
            .get();
      } finally {
        read.close();
      }
      need(
        !foreign,
        "请使用独立的yuanxiang.sqlite，旧版本数据库不会迁移",
        500,
        "DATABASE_PRODUCT_MISMATCH",
      );
    }
    super(options);
    this.draw = options.draw || randomInt;
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS yuanxiang_meta(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS banks(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,generation TEXT NOT NULL,coins INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,locked_task TEXT,rule TEXT NOT NULL,PRIMARY KEY(user_id,kind));
      CREATE TABLE IF NOT EXISTS bank_allocations(user_id TEXT NOT NULL,kind TEXT NOT NULL,generation TEXT NOT NULL,day TEXT NOT NULL,amount INTEGER NOT NULL,PRIMARY KEY(user_id,kind,generation,day));
      CREATE TABLE IF NOT EXISTS bank_tasks(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,generation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_meta(task_id TEXT PRIMARY KEY,rule TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,coins INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS skips(user_id TEXT NOT NULL,kind TEXT NOT NULL,generation TEXT NOT NULL,coins INTEGER NOT NULL,PRIMARY KEY(user_id,kind,generation,coins));
      CREATE TABLE IF NOT EXISTS referral(user_id TEXT PRIMARY KEY REFERENCES users(id),code TEXT UNIQUE NOT NULL,inviter_id TEXT REFERENCES users(id),bound_at INTEGER);
      CREATE TABLE IF NOT EXISTS support(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',reply TEXT,created_at INTEGER NOT NULL);
    `);
    if (!this.db.prepare("SELECT 1 FROM yuanxiang_meta WHERE id=1").get())
      this.transaction(() => {
        const { version, ...s } = super.settings();
        this.db
          .prepare("UPDATE settings SET json=? WHERE id=1")
          .run(JSON.stringify({ ...s, ...extra }));
        this.db.prepare("INSERT INTO yuanxiang_meta VALUES(1,1)").run();
      });
    this.roomContent = new RoomContent(this);
  }
  settings() {
    return { ...extra, ...super.settings() };
  }
  publicConfig() {
    return {
      ...super.publicConfig(),
      brand: "悦享金币",
      packetRules: `新一轮红包与宝箱每${this.settings().packetIntervalSeconds}秒累计${this.settings().packetIncrement}金币，上限${this.settings().packetCap}；均为开发参数`,
      prizes: this.prizes(),
      adSlots: {
        rewarded:
          this.development && this.adProvider === "demo"
            ? "demo_only"
            : "disabled",
        banner: "disabled",
        interstitial: "disabled",
        native: "disabled",
      },
      adPacing: this.adPacing(),
      referralCashEnabled: false,
      notice: "开发联调：金币不可兑现，广告为显式模拟，模拟完成不向微信付款。",
    };
  }
  adPacing() {
    const s = this.settings();
    return {
      mode:
        this.development && s.adPreviewEnabled ? "preview_only" : "disabled",
      version: s.version,
      native: {
        firstDelay: s.nativePreviewDelaySeconds,
        interval: s.nativePreviewIntervalSeconds,
      },
      banner: {
        firstDelay: s.bannerPreviewDelaySeconds,
        interval: s.bannerPreviewIntervalSeconds,
      },
      duration: s.adPreviewDurationSeconds,
      closeCooldown: s.adPreviewCloseCooldownSeconds,
      minGap: 30,
      sessionLimit: s.adPreviewSessionLimit,
      dailyLimit: s.adPreviewDailyLimit,
      interstitial: {
        enabled: false,
        reason: "场景及权限尚未核实，不按倒计时自动弹出",
      },
      notice:
        "仅开发位置预览；间隔为产品假设，不是微信允许频次。不计广告曝光、观看、收入或奖励。",
    };
  }
  prizes() {
    const s = this.settings();
    return [80, 120, 200, 500].map((coins) => ({
      coins,
      weight: s["prize" + coins + "Weight"],
    }));
  }
  rule() {
    const s = this.settings();
    return {
      increment: s.packetIncrement,
      cap: s.packetCap,
      interval: s.packetIntervalSeconds,
      version: s.version,
    };
  }
  ensureBanks(id) {
    const rule = this.rule();
    for (const kind of ["redpacket", "treasure"])
      this.db
        .prepare("INSERT OR IGNORE INTO banks VALUES(?,?,?,0,?,NULL,?)")
        .run(
          id,
          kind,
          uuid(),
          this.now() + rule.interval * 1000,
          JSON.stringify(rule),
        );
  }
  referralRow(id) {
    let row = this.db.prepare("SELECT * FROM referral WHERE user_id=?").get(id);
    if (!row) {
      this.db
        .prepare("INSERT INTO referral VALUES(?,?,NULL,NULL)")
        .run(id, randomBytes(6).toString("hex").toUpperCase());
      row = this.db.prepare("SELECT * FROM referral WHERE user_id=?").get(id);
    }
    return row;
  }
  login(identity, demo = true) {
    need(
      demo
        ? this.development
        : typeof identity === "string" && identity.startsWith("wx:"),
      "开发登录已关闭",
      403,
    );
    if (demo)
      need(
        typeof identity === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(identity),
        "安装标识格式错误",
      );
    return this.transaction(() => {
      const key = demo ? "demo:" + identity : identity;
      let user = this.db
        .prepare("SELECT * FROM users WHERE identity=?")
        .get(key);
      if (!user) {
        const id = uuid(),
          now = this.now();
        this.db
          .prepare(
            "INSERT INTO users(id,identity,name,next_chest_at,next_bag_at,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(id, key, "悦享用户", now + 120000, now, now);
        user = this.user(id);
      }
      this.referralRow(user.id);
      this.ensureBanks(user.id);
      const token = randomBytes(32).toString("hex");
      this.db
        .prepare("DELETE FROM sessions WHERE expires_at<=?")
        .run(this.now());
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(hash(token), user.id, this.now() + 604800000);
      return { token, user: this.profile(user.id) };
    });
  }
  profile(id) {
    const p = super.profile(id),
      today = dayKey(this.now());
    const signed = new Set(
      this.db
        .prepare(
          "SELECT day FROM tasks WHERE user_id=? AND kind='signin' AND state='rewarded'",
        )
        .all(id)
        .map((r) => r.day),
    );
    return {
      ...p,
      week: p.week.map((d) => ({
        ...d,
        dayNumber: d.day.slice(8),
        signed: signed.has(d.day),
      })),
      inviteCode: this.referralRow(id).code,
      remaining: this.quotas(id),
      pendingTask:
        this.db
          .prepare(
            "SELECT id,kind FROM tasks WHERE user_id=? AND state='pending' AND expires_at>? LIMIT 1",
          )
          .get(id, this.now()) || null,
    };
  }
  quotas(id) {
    const s = this.settings(),
      user = this.user(id),
      counts = Object.fromEntries(
        this.db
          .prepare(
            "SELECT kind,COUNT(*) AS n FROM tasks WHERE user_id=? AND day=? AND (state='rewarded' OR (state='pending' AND expires_at>?)) GROUP BY kind",
          )
          .all(id, dayKey(this.now()), this.now())
          .map((r) => [r.kind, r.n]),
      );
    return Object.fromEntries(
      Object.keys(names).map((kind) => [
        kind,
        Math.max(
          0,
          Math.min(
            (user.daily_limit ?? s.dailyAdLimit) -
              Object.values(counts).reduce((a, b) => a + b, 0),
            s[kind + "Limit"] - (counts[kind] || 0),
          ),
        ),
      ]),
    );
  }
  checkin() {
    throw new AppError(
      "签到需要完成签到激励任务；开发版请使用明确的模拟入口",
      409,
      "SIGNIN_TASK_REQUIRED",
    );
  }
  addFeed(id, kind, title, coins = 0, time = this.now()) {
    this.db
      .prepare(
        "INSERT INTO feed(user_id,kind,title,coins,created_at) VALUES(?,?,?,?,?)",
      )
      .run(id, kind, title, coins, time);
    this.db
      .prepare(
        "DELETE FROM feed WHERE user_id=? AND id NOT IN(SELECT id FROM feed WHERE user_id=? ORDER BY id DESC LIMIT 200)",
      )
      .run(id, id);
  }
  group(id, { roomActive = false } = {}) {
    this.pruneExpired();
    return this.transaction(() => {
      this.ensureBanks(id);
      const active = this.user(id).status === "active",
        banks = [];
      for (let bank of this.db
        .prepare("SELECT * FROM banks WHERE user_id=? ORDER BY kind")
        .all(id)) {
        const rule = JSON.parse(bank.rule);
        let paused = false;
        while (
          active &&
          !bank.locked_task &&
          bank.next_at <= this.now() &&
          bank.coins < rule.cap
        ) {
          const delta = Math.min(rule.increment, rule.cap - bank.coins),
            date = dayKey(bank.next_at);
          try {
            this.reserve(date, delta, this.settings().dailyBudgetCoins);
          } catch (e) {
            if (e.code !== "BUDGET_EXHAUSTED") throw e;
            paused = true;
            break;
          }
          this.db
            .prepare(
              "INSERT INTO bank_allocations VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind,generation,day) DO UPDATE SET amount=amount+excluded.amount",
            )
            .run(id, bank.kind, bank.generation, date, delta);
          bank = {
            ...bank,
            coins: bank.coins + delta,
            next_at: bank.next_at + rule.interval * 1000,
          };
          this.db
            .prepare(
              "UPDATE banks SET coins=?,next_at=? WHERE user_id=? AND kind=?",
            )
            .run(bank.coins, bank.next_at, id, bank.kind);
          this.addFeed(
            id,
            bank.kind,
            `${names[bank.kind]}已更新，可继续叠包`,
            bank.coins,
            bank.next_at - rule.interval * 1000,
          );
        }
        banks.push({
          kind: bank.kind,
          title: names[bank.kind],
          coins: bank.coins,
          cap: rule.cap,
          increment: rule.increment,
          interval: rule.interval,
          nextAt: bank.next_at,
          locked: !!bank.locked_task,
          generation: bank.generation,
          paused: paused || !active,
          atCap: bank.coins >= rule.cap,
        });
      }
      const result = {
        banks,
        feed: this.db
          .prepare(
            "SELECT id,kind,title,coins,created_at FROM feed WHERE user_id=? ORDER BY id DESC LIMIT 50",
          )
          .all(id)
          .reverse(),
        serverTime: this.now(),
        remaining: this.quotas(id),
        user: this.profile(id),
        room: {
          id: "01",
          title: "红包群01",
          memberCount: this.db.prepare("SELECT COUNT(*) AS n FROM users").get()
            .n,
        },
      };
      return {
        ...result,
        messages: buildRoomMessages({
          ...result,
          roomContent: this.roomContent.read(
            id,
            banks,
            roomActive && !result.user.pendingTask,
          ),
        }),
        roomDisclosure: "活动助手由运营方管理，非真实群友聊天。",
      };
    });
  }
  skip(id, kind) {
    need(["redpacket", "treasure"].includes(kind), "红包类型错误");
    this.group(id);
    return this.transaction(() => {
      const b = this.db
        .prepare("SELECT * FROM banks WHERE user_id=? AND kind=?")
        .get(id, kind);
      need(b.coins > 0, "还没有待领金额", 409);
      const row = this.db
        .prepare("INSERT OR IGNORE INTO skips VALUES(?,?,?,?)")
        .run(id, kind, b.generation, b.coins);
      if (row.changes)
        this.addFeed(id, kind, "已暂存，等待下一轮继续叠包", b.coins);
      return { preservedCoins: b.coins };
    });
  }
  createTask(id, kind) {
    need(
      this.development && this.adProvider === "demo",
      "真实广告及奖励验证尚未接入",
      503,
      "AD_NOT_CONNECTED",
    );
    need(Object.keys(names).includes(kind), "任务类型错误");
    this.pruneExpired();
    this.roomContent.pause(id);
    if (["redpacket", "treasure"].includes(kind)) this.group(id);
    try {
      return this.transaction(() => {
        this.ensureActive(id);
        const pending = this.db
          .prepare("SELECT * FROM tasks WHERE user_id=? AND state='pending'")
          .get(id);
        if (pending) {
          need(pending.kind === kind, "请先完成或取消当前任务", 409);
          return this.taskView(pending);
        }
        need(
          this.quotas(id)[kind] > 0,
          "今日该类或总奖励次数已达上限",
          409,
          "DAILY_LIMIT",
        );
        const s = this.settings(),
          today = dayKey(this.now()),
          taskId = uuid();
        let base, bank;
        if (kind === "signin") {
          need(this.user(id).signed_day !== today, "今日签到已完成", 409);
          base = s.signinBase;
          this.reserve(today, base + s.subsidyCoins, s.dailyBudgetCoins);
        } else if (kind === "bag") {
          need(
            this.now() >= this.user(id).next_bag_at,
            "福袋还在冷却中",
            409,
            "COOLDOWN",
          );
          const prizes = this.prizes();
          let draw = this.draw(100);
          need(
            Number.isInteger(draw) && draw >= 0 && draw < 100,
            "随机源不可用",
            500,
          );
          base = prizes.at(-1).coins;
          for (const prize of prizes) {
            if (draw < prize.weight) {
              base = prize.coins;
              break;
            }
            draw -= prize.weight;
          }
          this.reserve(today, base + s.subsidyCoins, s.dailyBudgetCoins);
          this.db
            .prepare("UPDATE users SET next_bag_at=? WHERE id=?")
            .run(this.now() + s.bagCooldownSeconds * 1000, id);
        } else {
          bank = this.db
            .prepare("SELECT * FROM banks WHERE user_id=? AND kind=?")
            .get(id, kind);
          need(
            bank && bank.coins > 0 && !bank.locked_task,
            "当前没有可打开的红包或宝箱",
            409,
            "COOLDOWN",
          );
          base = bank.coins;
          this.reserve(today, s.subsidyCoins, s.dailyBudgetCoins);
          this.db
            .prepare(
              "UPDATE banks SET locked_task=? WHERE user_id=? AND kind=?",
            )
            .run(taskId, id, kind);
          this.db
            .prepare("INSERT INTO bank_tasks VALUES(?,?,?,?)")
            .run(taskId, id, kind, bank.generation);
        }
        this.db
          .prepare(
            "INSERT INTO tasks(id,user_id,kind,provider,state,base,subsidy,day,rule_version,created_at,expires_at) VALUES(?,?,?,'demo','pending',?,?,?,?,?,?)",
          )
          .run(
            taskId,
            id,
            kind,
            base,
            s.subsidyCoins,
            today,
            s.version,
            this.now(),
            this.now() + 1800000,
          );
        this.db
          .prepare("INSERT INTO task_meta VALUES(?,?)")
          .run(taskId, JSON.stringify({ prizes: this.prizes() }));
        return this.taskView(
          this.db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId),
        );
      });
    } catch (e) {
      if (
        [
          "DAILY_LIMIT",
          "COOLDOWN",
          "ACCOUNT_RESTRICTED",
          "BUDGET_EXHAUSTED",
        ].includes(e.code)
      )
        this.audit("risk.task_blocked", id, { kind, code: e.code });
      throw e;
    }
  }
  taskView(task) {
    const view = {
      ...super.taskView(task),
      title: names[task.kind] || task.kind,
    };
    if (task.kind === "bag" && task.state !== "rewarded") {
      delete view.base;
      delete view.total;
      const meta = this.db
        .prepare("SELECT rule FROM task_meta WHERE task_id=?")
        .get(task.id);
      view.prizes = meta ? JSON.parse(meta.rule).prizes : this.prizes();
      const possible = view.prizes
        .filter((p) => p.weight > 0)
        .map((p) => p.coins);
      view.rewardRange = {
        min: Math.min(...possible),
        max: Math.max(...possible),
      };
    }
    return view;
  }
  releaseTask(task, state) {
    const link = this.db
      .prepare("SELECT * FROM bank_tasks WHERE task_id=?")
      .get(task.id);
    if (link) {
      this.db
        .prepare("UPDATE budgets SET reserved=reserved-? WHERE day=?")
        .run(task.subsidy, task.day);
      this.db
        .prepare(
          "UPDATE banks SET locked_task=NULL WHERE user_id=? AND kind=? AND locked_task=?",
        )
        .run(task.user_id, link.kind, task.id);
    } else
      this.db
        .prepare("UPDATE budgets SET reserved=reserved-? WHERE day=?")
        .run(task.base + task.subsidy, task.day);
    this.db.prepare("UPDATE tasks SET state=? WHERE id=?").run(state, task.id);
  }
  expireTasks() {
    for (const task of this.db
      .prepare("SELECT * FROM tasks WHERE state='pending' AND expires_at<=?")
      .all(this.now()))
      this.releaseTask(task, "expired");
  }
  cancelTask(id, taskId) {
    this.pruneExpired();
    return this.transaction(() => {
      const t = this.db
        .prepare("SELECT * FROM tasks WHERE id=? AND user_id=?")
        .get(taskId, id);
      need(t, "任务不存在", 404);
      if (t.state === "pending") this.releaseTask(t, "cancelled");
      return this.task(id, taskId);
    });
  }
  completeTask(id, taskId) {
    need(this.development && this.adProvider === "demo", "模拟发奖已关闭", 403);
    this.pruneExpired();
    return this.transaction(() => {
      const task = this.db
        .prepare("SELECT * FROM tasks WHERE id=? AND user_id=?")
        .get(taskId, id);
      need(task, "任务不存在", 404);
      if (task.state === "rewarded")
        return {
          task: this.taskView(task),
          user: this.profile(id),
          alreadyClaimed: true,
        };
      need(task.state === "pending", "任务已取消或过期", 409);
      need(this.now() >= task.created_at + 3000, "开发模拟尚未完成", 409);
      const link = this.db
        .prepare("SELECT * FROM bank_tasks WHERE task_id=?")
        .get(task.id);
      if (link) {
        const allocations = this.db
          .prepare(
            "SELECT * FROM bank_allocations WHERE user_id=? AND kind=? AND generation=?",
          )
          .all(id, link.kind, link.generation);
        need(
          allocations.reduce((n, a) => n + a.amount, 0) === task.base,
          "红包预算状态异常，请联系管理员",
          500,
        );
        for (const a of allocations)
          this.db
            .prepare(
              "UPDATE budgets SET reserved=reserved-?,spent=spent+? WHERE day=?",
            )
            .run(a.amount, a.amount, a.day);
        this.db
          .prepare(
            "DELETE FROM bank_allocations WHERE user_id=? AND kind=? AND generation=?",
          )
          .run(id, link.kind, link.generation);
        this.db
          .prepare(
            "UPDATE budgets SET reserved=reserved-?,spent=spent+? WHERE day=?",
          )
          .run(task.subsidy, task.subsidy, task.day);
        const rule = this.rule();
        this.db
          .prepare(
            "UPDATE banks SET generation=?,coins=0,next_at=?,locked_task=NULL,rule=? WHERE user_id=? AND kind=?",
          )
          .run(
            uuid(),
            this.now() + rule.interval * 1000,
            JSON.stringify(rule),
            id,
            link.kind,
          );
      } else
        this.db
          .prepare(
            "UPDATE budgets SET reserved=reserved-?,spent=spent+? WHERE day=?",
          )
          .run(task.base + task.subsidy, task.base + task.subsidy, task.day);
      this.entry(
        id,
        `task:${task.id}:base`,
        task.kind === "signin" ? "checkin" : "reward",
        names[task.kind] + "奖励",
        task.base,
        0,
        0,
        task.id,
      );
      if (task.subsidy)
        this.entry(
          id,
          `task:${task.id}:subsidy`,
          "subsidy",
          "运营补贴",
          task.subsidy,
          0,
          0,
          task.id,
        );
      this.db
        .prepare("UPDATE tasks SET state='rewarded',completed_at=? WHERE id=?")
        .run(this.now(), task.id);
      if (task.kind === "signin")
        this.db
          .prepare("UPDATE users SET signed_day=? WHERE id=?")
          .run(task.day, id);
      if (task.kind === "bag")
        this.db
          .prepare("UPDATE users SET next_bag_at=? WHERE id=?")
          .run(this.now() + this.settings().bagCooldownSeconds * 1000, id);
      this.addFeed(
        id,
        task.kind,
        names[task.kind] + "开发奖励已入账",
        task.base + task.subsidy,
      );
      return {
        task: this.taskView({ ...task, state: "rewarded" }),
        user: this.profile(id),
        alreadyClaimed: false,
      };
    });
  }
  demoReady(id) {
    need(this.development, "开发工具已关闭", 403);
    this.ensureBanks(id);
    this.db
      .prepare(
        "UPDATE banks SET next_at=? WHERE user_id=? AND locked_task IS NULL",
      )
      .run(this.now(), id);
    this.db
      .prepare("UPDATE users SET next_bag_at=? WHERE id=?")
      .run(this.now(), id);
    this.audit("demo.advance_timers", id);
    return this.profile(id);
  }
  referral(id) {
    const row = this.referralRow(id);
    const users = this.db
      .prepare(
        "SELECT u.id,u.created_at FROM referral r JOIN users u ON u.id=r.user_id WHERE r.inviter_id=? ORDER BY r.bound_at DESC LIMIT 100",
      )
      .all(id)
      .map((u) => ({
        id: u.id.slice(0, 8),
        createdAt: u.created_at,
        active: !!this.db
          .prepare(
            "SELECT 1 FROM tasks WHERE user_id=? AND state='rewarded' LIMIT 1",
          )
          .get(u.id),
      }));
    return {
      code: row.code,
      bound: !!row.inviter_id,
      invitedCount: this.db
        .prepare("SELECT COUNT(*) AS n FROM referral WHERE inviter_id=?")
        .get(id).n,
      activeCount: this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM referral r WHERE r.inviter_id=? AND EXISTS(SELECT 1 FROM tasks t WHERE t.user_id=r.user_id AND t.state='rewarded')",
        )
        .get(id).n,
      users,
      cashCommissionEnabled: false,
    };
  }
  bindReferral(id, code) {
    need(
      typeof code === "string" && /^[A-F0-9]{12}$/.test(code),
      "邀请码格式错误",
    );
    return this.transaction(() => {
      const me = this.referralRow(id),
        inviter = this.db
          .prepare("SELECT * FROM referral WHERE code=?")
          .get(code);
      need(inviter, "邀请码不存在", 404);
      need(inviter.user_id !== id, "不能邀请自己");
      if (me.inviter_id) {
        need(me.inviter_id === inviter.user_id, "邀请关系已绑定", 409);
        return this.referral(id);
      }
      need(
        this.now() - this.user(id).created_at <= 86400000,
        "仅注册24小时内可绑定",
        409,
      );
      let cursor = inviter.user_id;
      const visited = new Set([id]);
      while (cursor) {
        need(!visited.has(cursor), "不能建立循环邀请关系", 409);
        visited.add(cursor);
        cursor = this.db
          .prepare("SELECT inviter_id FROM referral WHERE user_id=?")
          .get(cursor)?.inviter_id;
      }
      this.db
        .prepare("UPDATE referral SET inviter_id=?,bound_at=? WHERE user_id=?")
        .run(inviter.user_id, this.now(), id);
      this.audit("referral.bind", id, {
        inviter: inviter.user_id,
        noCash: true,
      });
      return this.referral(id);
    });
  }
  support(id, message) {
    need(
      typeof message === "string" &&
        message.trim().length >= 2 &&
        message.length <= 1000,
      "请填写2—1000字问题",
    );
    need(
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM support WHERE user_id=? AND created_at>=?",
        )
        .get(id, this.startOfDay()).n < 5,
      "今日反馈已达5条，请等待处理",
      429,
    );
    const ticket = uuid();
    this.db
      .prepare("INSERT INTO support VALUES(?,?,?,'open',NULL,?)")
      .run(ticket, id, message.trim(), this.now());
    return { ticket, state: "open" };
  }
  supportList(id) {
    return this.db
      .prepare(
        "SELECT * FROM support WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
      )
      .all(id);
  }
  replySupport(ticket, reply) {
    need(
      typeof reply === "string" &&
        reply.trim().length >= 2 &&
        reply.length <= 1000,
      "回复需2—1000字",
    );
    return this.transaction(() => {
      need(
        this.db.prepare("SELECT 1 FROM support WHERE id=?").get(ticket),
        "反馈不存在",
        404,
      );
      this.db
        .prepare("UPDATE support SET state='resolved',reply=? WHERE id=?")
        .run(reply.trim(), ticket);
      this.audit("support.reply", ticket);
      return { resolved: true };
    });
  }
  adminOverview() {
    const base = super.adminOverview();
    return {
      ...base,
      packetReserves: this.db
        .prepare("SELECT COALESCE(SUM(amount),0) AS n FROM bank_allocations")
        .get().n,
      support: this.db
        .prepare("SELECT * FROM support ORDER BY created_at DESC LIMIT 100")
        .all(),
      referralStats: this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM referral WHERE inviter_id IS NOT NULL",
        )
        .get(),
      taskCounts: this.db
        .prepare(
          "SELECT kind,state,COUNT(*) AS n FROM tasks WHERE day=? GROUP BY kind,state",
        )
        .all(dayKey(this.now())),
    };
  }
  updateSettings(patch) {
    const ranges = {
      dailyAdLimit: [0, 100],
      dailyBudgetCoins: [0, 100000000],
      signinBase: [1, 10000],
      subsidyCoins: [0, 10000],
      packetIncrement: [100, 10000],
      packetCap: [1000, 100000],
      packetIntervalSeconds: [120, 86400],
      bagCooldownSeconds: [60, 86400],
      signinLimit: [0, 1],
      redpacketLimit: [0, 100],
      treasureLimit: [0, 100],
      bagLimit: [0, 100],
      prize80Weight: [0, 100],
      prize120Weight: [0, 100],
      prize200Weight: [0, 100],
      prize500Weight: [0, 100],
      adPreviewEnabled: [0, 1],
      nativePreviewDelaySeconds: [10, 300],
      nativePreviewIntervalSeconds: [60, 3600],
      bannerPreviewDelaySeconds: [10, 300],
      bannerPreviewIntervalSeconds: [60, 3600],
      adPreviewDurationSeconds: [5, 30],
      adPreviewCloseCooldownSeconds: [60, 3600],
      adPreviewSessionLimit: [0, 20],
      adPreviewDailyLimit: [0, 100],
    };
    need(
      patch &&
        Object.getPrototypeOf(patch) === Object.prototype &&
        Object.keys(patch).length,
      "配置为空",
    );
    for (const [k, v] of Object.entries(patch)) {
      const range = ranges[k];
      need(
        range && Number.isSafeInteger(v) && v >= range[0] && v <= range[1],
        "配置项无效：" + k,
      );
    }
    this.pruneExpired();
    return this.transaction(() => {
      const { version, ...before } = this.settings(),
        next = { ...before, ...patch };
      need(
        [80, 120, 200, 500].reduce(
          (n, p) => n + next["prize" + p + "Weight"],
          0,
        ) === 100,
        "福袋概率权重之和必须是100",
      );
      need(next.packetIncrement <= next.packetCap, "叠加增量不能超过上限");
      const b = this.db
        .prepare("SELECT * FROM budgets WHERE day=?")
        .get(dayKey(this.now()));
      need(
        !b || next.dailyBudgetCoins >= b.spent + b.reserved,
        "预算不能低于已支出及已承诺金额",
        409,
      );
      this.db
        .prepare("UPDATE settings SET json=?,version=version+1 WHERE id=1")
        .run(JSON.stringify(next));
      this.audit("settings.update", String(version + 1), {
        before,
        after: next,
      });
      return this.settings();
    });
  }
}
