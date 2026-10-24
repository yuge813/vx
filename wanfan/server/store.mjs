import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  ingredients,
  recipes,
  ingredientById,
  recipeById,
} from "./catalog.mjs";
export class ErrorResponse extends Error {
  constructor(message, status = 400, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const need = (ok, message, status = 400, code) => {
  if (!ok) throw new ErrorResponse(message, status, code);
};
const id = () => randomUUID();
const digest = (s) => createHash("sha256").update(s).digest("hex");
export const day = (ms) => new Date(ms + 28800000).toISOString().slice(0, 10);
const dayMs = (s) => Date.parse(s + "T00:00:00+08:00");
const validDay = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(dayMs(s)) &&
  day(dayMs(s)) === s;
const round = (n) => Math.round(n * 100) / 100;

export class DinnerStore {
  constructor({ path = ":memory:", development = true, now = Date.now } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.now = now;
    this.development = development;
    const existing = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
      )
      .get();
    if (
      existing &&
      !this.db
        .prepare("PRAGMA table_info(users)")
        .all()
        .some((column) => column.name === "prefs")
    ) {
      this.db.close();
      throw new ErrorResponse(
        "该文件属于其他产品，请为晚饭有谱使用独立数据库；未迁移旧数据",
        500,
        "DATABASE_PRODUCT_MISMATCH",
      );
    }
    this.db
      .exec(`PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,identity TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,prefs TEXT NOT NULL,rotation INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pantry(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,ingredient_id TEXT NOT NULL,amount REAL NOT NULL CHECK(amount>=0),expires TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,ingredient_id));
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,recipe_id TEXT NOT NULL,servings INTEGER NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,UNIQUE(user_id,date,recipe_id));
      CREATE TABLE IF NOT EXISTS purchases(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,ingredient_id TEXT NOT NULL,checked INTEGER NOT NULL,needed REAL NOT NULL,PRIMARY KEY(user_id,date,ingredient_id));
      CREATE TABLE IF NOT EXISTS checkins(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,date));
      CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,recipe_id TEXT NOT NULL,PRIMARY KEY(user_id,recipe_id));
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,date,kind));
      CREATE TABLE IF NOT EXISTS weeks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,json TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,type TEXT NOT NULL,reference TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,date,type,reference));
      CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,message TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',reply TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS recipe_flags(recipe_id TEXT PRIMARY KEY,active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,action TEXT NOT NULL,reference TEXT,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
    `);
    const seed = this.db.prepare(
      "INSERT OR IGNORE INTO recipe_flags VALUES (?,1)",
    );
    for (const r of recipes) seed.run(r.id);
  }
  close() {
    this.db.close();
  }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  user(userId) {
    const u = this.db.prepare("SELECT * FROM users WHERE id=?").get(userId);
    need(u, "用户不存在", 404);
    return u;
  }
  event(u, type, ref = "") {
    this.db
      .prepare("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?)")
      .run(u, day(this.now()), type, ref, this.now());
  }
  audit(action, reference, detail = {}) {
    this.db
      .prepare("INSERT INTO audit VALUES (?,?,?,?,?)")
      .run(id(), action, reference, JSON.stringify(detail), this.now());
  }
  config() {
    return {
      brand: "晚饭有谱",
      mode: this.development ? "development" : "production",
      adStatus: "disabled",
      cashStatus: "disabled",
      adReason: "奖励用途与平台权限未核实，真实广告保持关闭",
      rewardName: "周计划助手24小时内部体验",
      serverTime: this.now(),
      ingredients,
      catalogSize: this.activeRecipes().length,
      contentStatus: "原创开发稿，待人工烹饪校对",
    };
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
        "开发安装标识格式错误",
      );
    return this.tx(() => {
      const key = demo ? "demo:" + identity : identity;
      let u = this.db.prepare("SELECT * FROM users WHERE identity=?").get(key);
      if (!u) {
        u = { id: id() };
        this.db
          .prepare("INSERT INTO users VALUES (?,?,?,?,0)")
          .run(
            u.id,
            key,
            this.now(),
            JSON.stringify({ servings: 2, maxMinutes: 30, vegetarian: false }),
          );
      }
      const token = randomBytes(32).toString("hex");
      this.db
        .prepare("DELETE FROM sessions WHERE expires_at<=?")
        .run(this.now());
      this.db
        .prepare("INSERT INTO sessions VALUES (?,?,?)")
        .run(digest(token), u.id, this.now() + 604800000);
      return { token, user: this.profile(u.id) };
    });
  }
  auth(token) {
    need(typeof token === "string" && token.length <= 256, "请重新登录", 401);
    const row = this.db
      .prepare(
        "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(digest(token), this.now());
    need(row, "登录已过期", 401);
    return row.user_id;
  }
  profile(u) {
    const user = this.user(u),
      today = day(this.now()),
      prefs = JSON.parse(user.prefs),
      checks = this.db
        .prepare("SELECT date FROM checkins WHERE user_id=?")
        .all(u);
    const set = new Set(checks.map((c) => c.date));
    let streak = 0;
    let cursor = set.has(today) ? dayMs(today) : dayMs(today) - 86400000;
    while (set.has(day(cursor))) {
      streak++;
      cursor -= 86400000;
    }
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = day(this.now() - (6 - i) * 86400000);
      return {
        date: d,
        dayNumber: d.slice(8),
        label: i === 6 ? "今天" : d.slice(5).replace("-", "/"),
        signed: set.has(d),
      };
    });
    const grant = this.db
      .prepare(
        "SELECT * FROM grants WHERE user_id=? ORDER BY expires_at DESC LIMIT 1",
      )
      .get(u);
    return {
      id: u,
      prefs,
      signedToday: set.has(today),
      streak,
      week,
      createdAt: user.created_at,
      mealsCompleted: this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM plans WHERE user_id=? AND state='completed'",
        )
        .get(u).n,
      entitlement: {
        active: !!grant && grant.expires_at > this.now(),
        expiresAt: grant?.expires_at ?? null,
        source: grant?.source ?? null,
      },
      serverTime: this.now(),
    };
  }
  preferences(u, p) {
    need(
      p && Number.isInteger(p.servings) && p.servings >= 1 && p.servings <= 6,
      "人数应为1—6",
    );
    need([15, 20, 30, 45, 60].includes(p.maxMinutes), "时间选项无效");
    need(typeof p.vegetarian === "boolean", "饮食偏好格式错误");
    this.db
      .prepare("UPDATE users SET prefs=?,rotation=0 WHERE id=?")
      .run(
        JSON.stringify({
          servings: p.servings,
          maxMinutes: p.maxMinutes,
          vegetarian: p.vegetarian,
        }),
        u,
      );
    return this.profile(u);
  }
  activeRecipes() {
    const active = new Set(
      this.db
        .prepare("SELECT recipe_id FROM recipe_flags WHERE active=1")
        .all()
        .map((r) => r.recipe_id),
    );
    return recipes.filter((r) => active.has(r.id));
  }
  pantry(u) {
    return this.db
      .prepare(
        "SELECT * FROM pantry WHERE user_id=? ORDER BY expires IS NULL,expires,ingredient_id",
      )
      .all(u)
      .map((p) => ({
        ...p,
        ...ingredientById.get(p.ingredient_id),
        symbol: ingredientById.get(p.ingredient_id).name.slice(0, 1),
        expired: !!p.expires && p.expires < day(this.now()),
      }));
  }
  putPantry(u, p) {
    need(ingredientById.has(p.ingredientId), "未知食材");
    need(
      typeof p.amount === "number" &&
        Number.isFinite(p.amount) &&
        p.amount > 0 &&
        p.amount <= 100000 &&
        round(p.amount) === p.amount,
      "数量应为0以上、最多两位小数",
    );
    need(p.expires === null || validDay(p.expires), "请输入有效日期或留空");
    this.db
      .prepare(
        "INSERT INTO pantry VALUES (?,?,?,?,?) ON CONFLICT(user_id,ingredient_id) DO UPDATE SET amount=excluded.amount,expires=excluded.expires,updated_at=excluded.updated_at",
      )
      .run(u, p.ingredientId, p.amount, p.expires, this.now());
    this.event(u, "pantry_updated", p.ingredientId);
    return this.pantry(u);
  }
  removePantry(u, ingredient) {
    need(ingredientById.has(ingredient), "未知食材");
    this.db
      .prepare("DELETE FROM pantry WHERE user_id=? AND ingredient_id=?")
      .run(u, ingredient);
    return this.pantry(u);
  }
  recipe(u, recipeId, servings) {
    const r = this.activeRecipes().find((r) => r.id === recipeId);
    need(r, "菜谱已停用或不存在", 404);
    const count = servings ?? JSON.parse(this.user(u).prefs).servings;
    need(Number.isInteger(count) && count >= 1 && count <= 6, "人数应为1—6");
    const stock = new Map(
      this.pantry(u)
        .filter((p) => !p.expired)
        .map((p) => [p.id, p.amount]),
    );
    const favorite = !!this.db
      .prepare("SELECT 1 FROM favorites WHERE user_id=? AND recipe_id=?")
      .get(u, r.id);
    return {
      ...r,
      servings: count,
      favorite,
      ingredients: r.ingredients.map((x) => ({
        ...ingredientById.get(x.id),
        amount: round((x.amount * count) / 2),
        owned: stock.get(x.id) ?? 0,
        missing: round(
          Math.max(0, (x.amount * count) / 2 - (stock.get(x.id) ?? 0)),
        ),
      })),
    };
  }
  recommendations(u) {
    const prefs = JSON.parse(this.user(u).prefs),
      rotation = this.user(u).rotation;
    let candidates = this.activeRecipes()
      .filter(
        (r) =>
          r.minutes <= prefs.maxMinutes && (!prefs.vegetarian || r.vegetarian),
      )
      .map((r) => this.recipe(u, r.id));
    candidates.sort((a, b) => {
      const count = (r) =>
        r.ingredients.filter((x) => x.missing === 0).length /
        r.ingredients.length;
      return (
        count(b) - count(a) ||
        digest(u + day(this.now()) + a.id).localeCompare(
          digest(u + day(this.now()) + b.id),
        )
      );
    });
    if (!candidates.length) return [];
    const start = rotation % candidates.length;
    return candidates
      .slice(start)
      .concat(candidates.slice(0, start))
      .slice(0, 3);
  }
  rotate(u) {
    this.db.prepare("UPDATE users SET rotation=rotation+1 WHERE id=?").run(u);
    return this.recommendations(u);
  }
  plans(u, date = day(this.now())) {
    need(validDay(date), "日期格式错误");
    return this.db
      .prepare(
        "SELECT * FROM plans WHERE user_id=? AND date=? ORDER BY created_at,id",
      )
      .all(u, date)
      .map((p) => ({
        ...p,
        recipe: { ...recipeById.get(p.recipe_id), servings: p.servings },
      }));
  }
  plan(u, p) {
    const date = p.date ?? day(this.now());
    need(
      validDay(date) &&
        date >= day(this.now()) &&
        date <= day(this.now() + 6 * 86400000),
      "只支持今天起7天内的菜单",
    );
    const r = this.recipe(u, p.recipeId, p.servings);
    return this.tx(() => {
      let row = this.db
        .prepare(
          "SELECT * FROM plans WHERE user_id=? AND date=? AND recipe_id=?",
        )
        .get(u, date, r.id);
      if (row)
        need(
          row.servings === r.servings,
          "该菜已按" + row.servings + "人份加入，调整请先移除原计划",
          409,
        );
      if (!row) {
        const planId = id();
        this.db
          .prepare("INSERT INTO plans VALUES (?,?,?,?,?,'planned',?,NULL)")
          .run(planId, u, date, r.id, r.servings, this.now());
        this.event(u, "plan_added", planId);
        row = this.db.prepare("SELECT * FROM plans WHERE id=?").get(planId);
      }
      return row;
    });
  }
  removePlan(u, planId) {
    const r = this.db
      .prepare("SELECT * FROM plans WHERE id=? AND user_id=?")
      .get(planId, u);
    need(r, "菜单不存在", 404);
    need(r.state === "planned", "已完成的记录不能作为待做菜单删除", 409);
    this.db.prepare("DELETE FROM plans WHERE id=?").run(planId);
    return { ok: true };
  }
  complete(u, planId) {
    return this.tx(() => {
      const p = this.db
        .prepare("SELECT * FROM plans WHERE id=? AND user_id=?")
        .get(planId, u);
      need(p, "菜单不存在", 404);
      if (p.state === "completed")
        return { alreadyCompleted: true, user: this.profile(u) };
      need(p.date === day(this.now()), "只能完成今天的菜单", 409);
      const r = recipeById.get(p.recipe_id);
      for (const x of r.ingredients) {
        this.db
          .prepare(
            "UPDATE pantry SET amount=MAX(0,ROUND(amount-?,2)),updated_at=? WHERE user_id=? AND ingredient_id=? AND (expires IS NULL OR expires>=?)",
          )
          .run(
            (x.amount * p.servings) / 2,
            this.now(),
            u,
            x.id,
            day(this.now()),
          );
      }
      this.db.prepare("DELETE FROM pantry WHERE user_id=? AND amount=0").run(u);
      this.db
        .prepare("UPDATE plans SET state='completed',completed_at=? WHERE id=?")
        .run(this.now(), p.id);
      this.event(u, "meal_completed", p.id);
      return { alreadyCompleted: false, user: this.profile(u) };
    });
  }
  shopping(u, date = day(this.now())) {
    const total = new Map();
    for (const p of this.plans(u, date).filter((p) => p.state === "planned"))
      for (const x of recipeById.get(p.recipe_id).ingredients)
        total.set(x.id, (total.get(x.id) ?? 0) + (x.amount * p.servings) / 2);
    const stock = new Map(
      this.pantry(u)
        .filter((x) => !x.expired)
        .map((x) => [x.id, x.amount]),
    );
    const checked = new Map(
      this.db
        .prepare("SELECT * FROM purchases WHERE user_id=? AND date=?")
        .all(u, date)
        .map((x) => [x.ingredient_id, x]),
    );
    return [...total]
      .map(([key, amount]) => {
        const missing = round(Math.max(0, amount - (stock.get(key) ?? 0)));
        const prev = checked.get(key);
        return {
          ...ingredientById.get(key),
          amount: round(amount),
          missing,
          checked: !!prev?.checked && round(prev.needed) === missing,
        };
      })
      .filter((x) => x.missing > 0);
  }
  purchase(u, key, checked) {
    need(typeof checked === "boolean", "采购状态格式错误");
    const row = this.shopping(u).find((x) => x.id === key);
    need(row, "该食材目前不在缺料清单中", 404);
    this.db
      .prepare(
        "INSERT INTO purchases VALUES (?,?,?,?,?) ON CONFLICT(user_id,date,ingredient_id) DO UPDATE SET checked=excluded.checked,needed=excluded.needed",
      )
      .run(u, day(this.now()), key, Number(checked), row.missing);
    return this.shopping(u);
  }
  checkin(u) {
    return this.tx(() => {
      const result = this.db
        .prepare("INSERT OR IGNORE INTO checkins VALUES (?,?,?)")
        .run(u, day(this.now()), this.now());
      this.event(u, "checkin");
      return { alreadyClaimed: !result.changes, user: this.profile(u) };
    });
  }
  favorite(u, recipeId, value) {
    this.recipe(u, recipeId);
    need(typeof value === "boolean", "收藏状态格式错误");
    if (value)
      this.db
        .prepare("INSERT OR IGNORE INTO favorites VALUES (?,?)")
        .run(u, recipeId);
    else
      this.db
        .prepare("DELETE FROM favorites WHERE user_id=? AND recipe_id=?")
        .run(u, recipeId);
    return { favorite: value };
  }
  journal(u) {
    return {
      user: this.profile(u),
      history: this.db
        .prepare(
          "SELECT * FROM plans WHERE user_id=? AND state='completed' ORDER BY completed_at DESC LIMIT 60",
        )
        .all(u)
        .map((p) => ({
          ...p,
          title: recipeById.get(p.recipe_id)?.title,
          art: recipeById.get(p.recipe_id)?.art,
        })),
      favorites: this.db
        .prepare("SELECT recipe_id FROM favorites WHERE user_id=?")
        .all(u)
        .filter((x) => this.activeRecipes().some((r) => r.id === x.recipe_id))
        .map((x) => this.recipe(u, x.recipe_id)),
      grants: this.db
        .prepare(
          "SELECT id,kind,source,expires_at,created_at FROM grants WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
        )
        .all(u),
      feedback: this.db
        .prepare(
          "SELECT id,message,state,reply,created_at FROM feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
        )
        .all(u),
    };
  }
  dashboard(u) {
    this.event(u, "visit");
    return {
      config: this.config(),
      user: this.profile(u),
      recommendations: this.recommendations(u),
      plans: this.plans(u),
      pantry: this.pantry(u),
      shopping: this.shopping(u),
    };
  }
  grant(u) {
    need(this.development, "正式环境不允许内部测试授予", 403);
    this.user(u);
    return this.tx(() => {
      const date = day(this.now());
      const existing = this.db
        .prepare(
          "SELECT * FROM grants WHERE user_id=? AND date=? AND kind='weekly'",
        )
        .get(u, date);
      if (existing) return existing;
      const used = this.db
        .prepare("SELECT COUNT(*) AS n FROM grants WHERE date=?")
        .get(date).n;
      need(used < 100, "今日内部体验额度已用完", 409);
      const grantId = id();
      this.db
        .prepare(
          "INSERT INTO grants VALUES (?,?,?,'weekly','internal_admin',?,?)",
        )
        .run(grantId, u, date, this.now() + 86400000, this.now());
      this.audit("entitlement.internal_grant", u, {
        grantId,
        kind: "weekly",
        noAd: true,
      });
      return this.db.prepare("SELECT * FROM grants WHERE id=?").get(grantId);
    });
  }
  generateWeek(u) {
    need(
      this.profile(u).entitlement.active,
      "周计划助手尚未开放，内部体验需要管理员授予；没有广告观看入口",
      403,
      "ENTITLEMENT_REQUIRED",
    );
    const prefs = JSON.parse(this.user(u).prefs),
      candidates = this.activeRecipes().filter(
        (r) =>
          r.minutes <= prefs.maxMinutes && (!prefs.vegetarian || r.vegetarian),
      );
    need(candidates.length, "当前偏好下没有可用菜谱，请调整时间或口味", 409);
    const count = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM events WHERE user_id=? AND date=? AND type='week_generated'",
      )
      .get(u, day(this.now())).n;
    need(count < 10, "今日周计划生成次数已达内部上限", 409);
    return this.tx(() => {
      const weekId = id(),
        start =
          parseInt(digest(u + day(this.now())).slice(0, 8), 16) %
          candidates.length;
      const days = Array.from({ length: 7 }, (_, i) => {
        const r = candidates[(start + i) % candidates.length];
        return {
          date: day(this.now() + i * 86400000),
          recipeId: r.id,
          title: r.title,
          minutes: r.minutes,
          servings: prefs.servings,
          art: r.art,
        };
      });
      const amounts = new Map();
      for (const p of days)
        for (const x of recipeById.get(p.recipeId).ingredients)
          amounts.set(
            x.id,
            (amounts.get(x.id) ?? 0) + (x.amount * p.servings) / 2,
          );
      const list = [...amounts].map(([key, n]) => ({
        ...ingredientById.get(key),
        amount: round(n),
      }));
      const result = {
        id: weekId,
        days,
        ingredients: list,
        note: "合计用料不扣减库存；按实际安排采购。偏好下菜谱不足7道时会重复。",
        createdAt: this.now(),
      };
      this.db
        .prepare("INSERT INTO weeks VALUES (?,?,?,?)")
        .run(weekId, u, JSON.stringify(result), this.now());
      this.event(u, "week_generated", weekId);
      return result;
    });
  }
  latestWeek(u) {
    const row = this.db
      .prepare(
        "SELECT json FROM weeks WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(u);
    return row ? JSON.parse(row.json) : null;
  }
  feedback(u, message) {
    need(
      typeof message === "string" &&
        message.trim().length >= 2 &&
        message.length <= 1000,
      "反馈需要2—1000字",
    );
    const count = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM feedback WHERE user_id=? AND created_at>=?",
      )
      .get(u, dayMs(day(this.now()))).n;
    need(count < 5, "今天已提交5条反馈，请等待处理", 429);
    const feedbackId = id();
    this.db
      .prepare("INSERT INTO feedback VALUES (?,?,?,'open',NULL,?)")
      .run(feedbackId, u, message.trim(), this.now());
    this.event(u, "feedback", feedbackId);
    return { id: feedbackId, state: "open" };
  }
  deleteAccount(u) {
    return this.tx(() => {
      this.db.prepare("DELETE FROM audit WHERE reference=?").run(u);
      this.db.prepare("DELETE FROM users WHERE id=?").run(u);
      return { deleted: true };
    });
  }
  overview() {
    const today = day(this.now()),
      stats = this.db
        .prepare(
          "SELECT COUNT(DISTINCT user_id) AS activeUsers,COUNT(DISTINCT CASE WHEN type='plan_added' THEN user_id END) AS planners,COUNT(DISTINCT CASE WHEN type='meal_completed' THEN user_id END) AS cooks,COUNT(DISTINCT CASE WHEN type='checkin' THEN user_id END) AS checkins FROM events WHERE date=?",
        )
        .get(today);
    const cohorts = [1, 7].map((n) => {
      const cohortDay = day(this.now() - n * 86400000),
        cohort = this.db
          .prepare("SELECT id FROM users WHERE created_at>=? AND created_at<?")
          .all(dayMs(cohortDay), dayMs(cohortDay) + 86400000),
        retained = cohort.filter((u) =>
          this.db
            .prepare(
              "SELECT 1 FROM events WHERE user_id=? AND date=? AND type='visit'",
            )
            .get(u.id, today),
        ).length;
      return {
        days: n,
        cohortDay,
        cohortSize: cohort.length,
        retained,
        rate: cohort.length ? retained / cohort.length : null,
      };
    });
    return {
      config: this.config(),
      today,
      stats,
      totalUsers: this.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
      cohorts,
      users: this.db
        .prepare(
          "SELECT id,created_at FROM users ORDER BY created_at DESC LIMIT 100",
        )
        .all()
        .map((u) => ({ ...u, ...this.profile(u.id) })),
      recipes: recipes.map((r) => ({
        ...r,
        active: !!this.db
          .prepare("SELECT active FROM recipe_flags WHERE recipe_id=?")
          .get(r.id)?.active,
      })),
      feedback: this.db
        .prepare("SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100")
        .all(),
      audit: this.db
        .prepare(
          "SELECT * FROM audit ORDER BY created_at DESC,rowid DESC LIMIT 50",
        )
        .all(),
    };
  }
  setRecipe(recipeId, active) {
    need(
      recipeById.has(recipeId) && typeof active === "boolean",
      "菜谱配置无效",
    );
    this.tx(() => {
      this.db
        .prepare("UPDATE recipe_flags SET active=? WHERE recipe_id=?")
        .run(Number(active), recipeId);
      this.audit("recipe.visibility", recipeId, { active });
    });
    return { active };
  }
  reply(feedbackId, text) {
    need(
      typeof text === "string" &&
        text.trim().length >= 2 &&
        text.length <= 1000,
      "回复需要2—1000字",
    );
    const row = this.db
      .prepare("SELECT * FROM feedback WHERE id=?")
      .get(feedbackId);
    need(row, "反馈不存在", 404);
    this.tx(() => {
      this.db
        .prepare("UPDATE feedback SET state='resolved',reply=? WHERE id=?")
        .run(text.trim(), feedbackId);
      this.audit("feedback.reply", feedbackId, { resolved: true });
    });
    return { resolved: true };
  }
}
