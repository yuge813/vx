import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') {
    super(message); this.status = status; this.code = code;
  }
}
const assert = (ok, message, status = 400, code) => { if (!ok) throw new AppError(message, status, code); };
const uid = () => randomUUID();
const hash = token => createHash('sha256').update(token).digest('hex');
export const dayKey = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const defaults = Object.freeze({
  dailyAdLimit: 10, dailyBudgetCoins: 100000, checkinCoins: 10,
  chestBase: 180, bagBase: 80, signinBase: 100, subsidyCoins: 20,
  chestCooldownSeconds: 120, bagCooldownSeconds: 60,
  coinsPerYuan: 1000, minimumWithdrawalCoins: 1000
});

export class Store {
  constructor({ path = ':memory:', development = true, adProvider = 'demo', now = Date.now } = {}) {
    assert(development || adProvider === 'disabled', '生产环境不能启用模拟广告', 500);
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.development = development; this.adProvider = adProvider; this.now = now;
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
        frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen>=0), paid INTEGER NOT NULL DEFAULT 0 CHECK(paid>=0),
        signed_day TEXT, next_chest_at INTEGER NOT NULL, next_bag_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', daily_limit INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS budgets (day TEXT PRIMARY KEY, reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0), spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0));
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
        provider TEXT NOT NULL, state TEXT NOT NULL, base INTEGER NOT NULL, subsidy INTEGER NOT NULL,
        day TEXT NOT NULL, rule_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS task_user_day ON tasks(user_id,day,state);
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_key TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL, title TEXT NOT NULL, available_delta INTEGER NOT NULL,
        frozen_delta INTEGER NOT NULL DEFAULT 0, paid_delta INTEGER NOT NULL DEFAULT 0,
        reference TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ledger_user_time ON ledger(user_id,created_at);
      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), coins INTEGER NOT NULL CHECK(coins>0),
        amount_fen INTEGER NOT NULL CHECK(amount_fen>0), state TEXT NOT NULL, reason TEXT,
        request_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(user_id,request_key)
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, reference TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
    `);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?,1)').run(JSON.stringify(defaults));
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  settings() {
    const row = this.db.prepare('SELECT * FROM settings WHERE id=1').get();
    return { ...JSON.parse(row.json), version: row.version };
  }
  publicConfig() {
    return { ...this.settings(), mode: this.development ? 'development' : 'production',
      adProvider: this.adProvider, cashTransfersEnabled: false, demoTransfersEnabled: this.development,
      demoAdSeconds: 3, notice: '当前为开发原型：模拟广告无收益，演示金币不可兑现，模拟转账不会进入微信零钱。' };
  }
  audit(action, reference, detail = {}) {
    this.db.prepare('INSERT INTO audit VALUES (?,?,?,?,?)').run(uid(), action, reference, JSON.stringify(detail), this.now());
  }
  entry(userId, eventKey, type, title, available, frozen = 0, paid = 0, reference = null) {
    this.db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(uid(), userId, eventKey, type, title, available, frozen, paid, reference, this.now());
    this.db.prepare('UPDATE users SET balance=balance+?, frozen=frozen+?, paid=paid+? WHERE id=?').run(available, frozen, paid, userId);
  }
  login(identity, demo = true) {
    assert(demo ? this.development : identity.startsWith('wx:'), '开发登录已关闭', 403);
    if (demo) assert(typeof identity === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(identity), '安装标识格式错误');
    const key = demo ? `demo:${identity}` : identity;
    return this.transaction(() => {
      let user = this.db.prepare('SELECT * FROM users WHERE identity=?').get(key);
      if (!user) {
        const id = uid(), now = this.now(), settings = this.settings();
        this.db.prepare('INSERT INTO users (id,identity,name,next_chest_at,next_bag_at,created_at) VALUES (?,?,?,?,?,?)')
          .run(id, key, demo ? '星享体验官' : '星享用户', now + settings.chestCooldownSeconds * 1000, now, now);
        if (demo) this.entry(id, `seed:${id}`, 'demo_seed', '开发演示初始金币（不可兑现）', 3600);
        for (const title of ['整理今天的待办清单', '完成一次桌面整理', '记录一件值得坚持的小事']) {
          this.db.prepare('INSERT INTO plans VALUES (?,?,?,0,?)').run(uid(), id, title, now);
        }
        user = this.user(id);
      }
      assert(user.status === 'active', '账户已限制，请通过客服申诉', 403, 'ACCOUNT_RESTRICTED');
      const token = randomBytes(32).toString('hex');
      this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.now());
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), user.id, this.now() + 7 * 86400000);
      return { token, user: this.profile(user.id) };
    });
  }
  authenticate(token) {
    assert(typeof token === 'string' && token.length <= 256, '请重新登录', 401);
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), this.now());
    assert(row, '登录已过期，请重新登录', 401);
    return row.user_id;
  }
  user(id) {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    assert(row, '用户不存在', 404); return row;
  }
  ensureActive(id) { assert(this.user(id).status === 'active', '账户受限，请联系客服申诉', 403, 'ACCOUNT_RESTRICTED'); }
  profile(id) {
    const user = this.user(id), day = dayKey(this.now());
    const signedDays = new Set(this.db.prepare("SELECT created_at FROM ledger WHERE user_id=? AND type='checkin' AND created_at>=?")
      .all(id, this.startOfDay() - 6 * 86400000).map(row => dayKey(row.created_at)));
    const week = Array.from({ length: 7 }, (_, i) => {
      const key = dayKey(this.now() - (6 - i) * 86400000);
      return { day: key, label: i === 6 ? '今天' : key.slice(5).replace('-', '/'), signed: signedDays.has(key) };
    });
    const earnedToday = this.db.prepare("SELECT COALESCE(SUM(available_delta),0) AS n FROM ledger WHERE user_id=? AND type IN ('reward','subsidy','checkin') AND created_at>=? AND created_at<?")
      .get(id, this.startOfDay(), this.startOfDay() + 86400000).n;
    const adsToday = this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND day=? AND state='rewarded'").get(id, day).n;
    return { id: user.id, name: user.name, balance: user.balance, frozen: user.frozen, paid: user.paid,
      signedToday: user.signed_day === day, nextChestAt: user.next_chest_at, nextBagAt: user.next_bag_at,
      status: user.status, dailyLimit: user.daily_limit ?? this.settings().dailyAdLimit,
      earnedToday, adsToday, week, serverTime: this.now() };
  }
  startOfDay() { return Date.parse(`${dayKey(this.now())}T00:00:00+08:00`); }
  expireTasks() {
    const rows = this.db.prepare("SELECT * FROM tasks WHERE state='pending' AND expires_at<=?").all(this.now());
    for (const task of rows) {
      this.db.prepare("UPDATE tasks SET state='expired' WHERE id=?").run(task.id);
      this.db.prepare('UPDATE budgets SET reserved=reserved-? WHERE day=?').run(task.base + task.subsidy, task.day);
    }
  }
  pruneExpired() { this.transaction(() => this.expireTasks()); }
  reserve(day, amount, limit) {
    this.db.prepare('INSERT OR IGNORE INTO budgets(day) VALUES (?)').run(day);
    const b = this.db.prepare('SELECT * FROM budgets WHERE day=?').get(day);
    assert(b.spent + b.reserved + amount <= limit, '今日奖励额度已用完，请稍后再来', 409, 'BUDGET_EXHAUSTED');
    this.db.prepare('UPDATE budgets SET reserved=reserved+? WHERE day=?').run(amount, day);
  }
  checkin(id) {
    this.pruneExpired();
    return this.transaction(() => {
      this.ensureActive(id);
      const day = dayKey(this.now()), settings = this.settings();
      if (this.user(id).signed_day === day) return { alreadyClaimed: true, user: this.profile(id) };
      this.reserve(day, settings.checkinCoins, settings.dailyBudgetCoins);
      this.entry(id, `checkin:${id}:${day}`, 'checkin', '每日签到', settings.checkinCoins);
      this.db.prepare('UPDATE budgets SET reserved=reserved-?, spent=spent+? WHERE day=?').run(settings.checkinCoins, settings.checkinCoins, day);
      this.db.prepare('UPDATE users SET signed_day=? WHERE id=?').run(day, id);
      return { alreadyClaimed: false, user: this.profile(id), coins: settings.checkinCoins };
    });
  }
  createTask(id, kind) {
    assert(this.development && this.adProvider === 'demo', '真实广告验证尚未接入，广告奖励入口已关闭', 503, 'AD_NOT_CONNECTED');
    assert(['chest', 'bag', 'signin_bonus'].includes(kind), '未知任务类型');
    this.pruneExpired();
    return this.transaction(() => {
      this.ensureActive(id);
      const user = this.user(id), settings = this.settings(), now = this.now(), day = dayKey(now);
      const pending = this.db.prepare("SELECT * FROM tasks WHERE user_id=? AND state='pending'").get(id);
      if (pending) { assert(pending.kind === kind, '请先完成或取消当前任务', 409); return this.taskView(pending); }
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND day=? AND state IN ('pending','rewarded')").get(id, day).n;
      assert(count < (user.daily_limit ?? settings.dailyAdLimit), '今日广告奖励次数已达上限', 409, 'DAILY_LIMIT');
      if (kind === 'signin_bonus') {
        assert(user.signed_day === day, '请先完成今日签到', 409);
        const exists = this.db.prepare("SELECT id FROM tasks WHERE user_id=? AND day=? AND kind='signin_bonus' AND state='rewarded'").get(id, day);
        assert(!exists, '今日签到加奖已领取', 409);
      }
      if (kind === 'chest') assert(now >= user.next_chest_at, '宝箱还在准备中', 409, 'COOLDOWN');
      if (kind === 'bag') assert(now >= user.next_bag_at, '福袋还在准备中', 409, 'COOLDOWN');
      const base = kind === 'chest' ? settings.chestBase : kind === 'bag' ? settings.bagBase : settings.signinBase;
      this.reserve(day, base + settings.subsidyCoins, settings.dailyBudgetCoins);
      const taskId = uid();
      this.db.prepare("INSERT INTO tasks VALUES (?,?,?,'demo','pending',?,?,?,?,?,?,NULL)")
        .run(taskId, id, kind, base, settings.subsidyCoins, day, settings.version, now, now + 1800000);
      return this.taskView(this.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId));
    });
  }
  taskView(task) { return { id: task.id, kind: task.kind, state: task.state, base: task.base, subsidy: task.subsidy,
    total: task.base + task.subsidy, provider: task.provider, ruleVersion: task.rule_version,
    createdAt: task.created_at, expiresAt: task.expires_at, completeAfter: task.created_at + 3000 }; }
  task(id, taskId) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId, id);
    assert(task, '任务不存在', 404);
    return this.taskView(task.state === 'pending' && task.expires_at <= this.now() ? { ...task, state: 'expired' } : task);
  }
  completeTask(id, taskId) {
    assert(this.development && this.adProvider === 'demo', '模拟发奖已关闭', 403);
    this.pruneExpired();
    return this.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId, id);
      assert(task, '任务不存在', 404);
      if (task.state === 'rewarded') return { task: this.taskView(task), user: this.profile(id), alreadyClaimed: true };
      assert(task.state === 'pending', '任务已取消或过期', 409);
      assert(this.now() >= task.created_at + 3000, '演示尚未完成', 409);
      // 此处只验证开发演示流程，不构造或信任所谓真实广告凭证。
      const titles = { chest: '宝箱奖励', bag: '成长福袋奖励', signin_bonus: '签到加奖' };
      this.entry(id, `task:${taskId}:base`, 'reward', titles[task.kind], task.base, 0, 0, taskId);
      if (task.subsidy) this.entry(id, `task:${taskId}:subsidy`, 'subsidy', '运营补贴', task.subsidy, 0, 0, taskId);
      this.db.prepare("UPDATE tasks SET state='rewarded', completed_at=? WHERE id=?").run(this.now(), taskId);
      this.db.prepare('UPDATE budgets SET reserved=reserved-?, spent=spent+? WHERE day=?').run(task.base + task.subsidy, task.base + task.subsidy, task.day);
      const settings = this.settings();
      if (task.kind === 'chest') this.db.prepare('UPDATE users SET next_chest_at=? WHERE id=?').run(this.now() + settings.chestCooldownSeconds * 1000, id);
      if (task.kind === 'bag') this.db.prepare('UPDATE users SET next_bag_at=? WHERE id=?').run(this.now() + settings.bagCooldownSeconds * 1000, id);
      return { task: this.taskView({ ...task, state: 'rewarded' }), user: this.profile(id), alreadyClaimed: false };
    });
  }
  cancelTask(id, taskId) {
    this.pruneExpired();
    return this.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId, id);
      assert(task, '任务不存在', 404);
      if (task.state === 'pending') {
        this.db.prepare("UPDATE tasks SET state='cancelled' WHERE id=?").run(task.id);
        this.db.prepare('UPDATE budgets SET reserved=reserved-? WHERE day=?').run(task.base + task.subsidy, task.day);
      }
      return this.task(id, taskId);
    });
  }
  ledger(id) { return this.db.prepare('SELECT * FROM ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(id); }
  withdrawals(id) { return this.db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(id); }
  withdraw(id, coins, requestKey) {
    assert(this.development, '真实现金提现尚未开放，当前不能创建转账订单', 503, 'PAYMENT_NOT_CONNECTED');
    assert(Number.isSafeInteger(coins) && coins > 0 && coins <= 100000000, '金币数量必须是有效整数');
    assert(typeof requestKey === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(requestKey), '缺少有效幂等编号');
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM withdrawals WHERE user_id=? AND request_key=?').get(id, requestKey);
      if (existing) { assert(existing.coins === coins, '相同请求编号的金额不一致', 409); return existing; }
      this.ensureActive(id);
      const settings = this.settings();
      assert(coins >= settings.minimumWithdrawalCoins, `最低申请 ${settings.minimumWithdrawalCoins} 金币`);
      assert((coins * 100) % settings.coinsPerYuan === 0, '金额必须能精确换算为分');
      assert(this.user(id).balance >= coins, '可用金币不足', 409);
      const orderId = uid(), now = this.now();
      this.db.prepare("INSERT INTO withdrawals VALUES (?,?,?,?,'pending_review',NULL,?,?,?)")
        .run(orderId, id, coins, coins * 100 / settings.coinsPerYuan, requestKey, now, now);
      this.entry(id, `withdraw:${orderId}:freeze`, 'withdraw_freeze', '演示提现申请：冻结', -coins, coins, 0, orderId);
      return this.db.prepare('SELECT * FROM withdrawals WHERE id=?').get(orderId);
    });
  }
  reviewWithdrawal(orderId, action, reason = '') {
    assert(this.development, '真实转账尚未接入', 503);
    assert(['approve', 'reject', 'simulate_pay'].includes(action), '未知审核操作');
    assert(typeof reason === 'string' && reason.length <= 200, '备注过长');
    return this.transaction(() => {
      const order = this.db.prepare('SELECT * FROM withdrawals WHERE id=?').get(orderId);
      assert(order, '申请不存在', 404);
      const target = { approve: 'approved', reject: 'rejected', simulate_pay: 'demo_paid' }[action];
      if (order.state === target) return order;
      assert(action === 'simulate_pay' ? order.state === 'approved' : order.state === 'pending_review', '订单状态不允许此操作', 409);
      if (action === 'reject') {
        assert(reason.trim(), '拒绝申请必须提供原因');
        this.entry(order.user_id, `withdraw:${orderId}:return`, 'withdraw_return', '演示提现驳回：退回金币', order.coins, -order.coins, 0, orderId);
      }
      if (action === 'simulate_pay') this.entry(order.user_id, `withdraw:${orderId}:paid`, 'withdraw_paid', '模拟转账完成（未向微信付款）', 0, -order.coins, order.coins, orderId);
      this.db.prepare('UPDATE withdrawals SET state=?,reason=?,updated_at=? WHERE id=?').run(target, reason.trim(), this.now(), orderId);
      this.audit(`withdrawal.${action}`, orderId, { reason: reason.trim() });
      return this.db.prepare('SELECT * FROM withdrawals WHERE id=?').get(orderId);
    });
  }
  plans(id) { return this.db.prepare('SELECT id,title,done FROM plans WHERE user_id=? ORDER BY created_at,id').all(id); }
  addPlan(id, title) {
    this.ensureActive(id);
    assert(typeof title === 'string' && title.trim().length > 0 && title.trim().length <= 60, '计划应为1—60字');
    assert(this.plans(id).length < 30, '最多保留30条计划');
    const planId = uid();
    this.db.prepare('INSERT INTO plans VALUES (?,?,?,0,?)').run(planId, id, title.trim(), this.now());
    return this.plans(id);
  }
  changePlan(id, planId, done) {
    this.ensureActive(id); assert(typeof done === 'boolean', '状态格式错误');
    const result = this.db.prepare('UPDATE plans SET done=? WHERE id=? AND user_id=?').run(Number(done), planId, id);
    assert(result.changes, '计划不存在', 404); return this.plans(id);
  }
  removePlan(id, planId) {
    this.ensureActive(id);
    const result = this.db.prepare('DELETE FROM plans WHERE id=? AND user_id=?').run(planId, id);
    assert(result.changes, '计划不存在', 404); return this.plans(id);
  }
  demoReady(id) {
    assert(this.development, '开发工具已关闭', 403);
    this.db.prepare('UPDATE users SET next_chest_at=?,next_bag_at=? WHERE id=?').run(this.now(), this.now(), id);
    this.audit('demo.skip_cooldown', id); return this.profile(id);
  }
  adminOverview() {
    return this.transaction(() => {
      this.expireTasks();
      return { config: this.publicConfig(),
        users: this.db.prepare('SELECT id,name,balance,frozen,paid,status,daily_limit,created_at FROM users ORDER BY created_at DESC LIMIT 100').all(),
        withdrawals: this.db.prepare('SELECT * FROM withdrawals ORDER BY created_at DESC,rowid DESC LIMIT 100').all(),
        budget: this.db.prepare('SELECT * FROM budgets WHERE day=?').get(dayKey(this.now())) ?? { day: dayKey(this.now()), spent: 0, reserved: 0 },
        stats: this.db.prepare('SELECT COUNT(*) AS users,COALESCE(SUM(balance),0) AS balance,COALESCE(SUM(frozen),0) AS frozen,COALESCE(SUM(paid),0) AS paid FROM users').get(),
        audit: this.db.prepare('SELECT * FROM audit ORDER BY created_at DESC,rowid DESC LIMIT 50').all() };
    });
  }
  updateSettings(patch) {
    const ranges = { dailyAdLimit: [0,100], dailyBudgetCoins: [0,100000000], checkinCoins: [0,10000], chestBase: [1,10000], bagBase: [1,10000], signinBase: [1,10000], subsidyCoins: [0,10000], chestCooldownSeconds: [120,86400], bagCooldownSeconds: [60,86400] };
    assert(patch && Object.getPrototypeOf(patch) === Object.prototype && Object.keys(patch).length > 0, '配置为空');
    for (const [key, value] of Object.entries(patch)) {
      const range = ranges[key]; assert(range && Number.isSafeInteger(value) && value >= range[0] && value <= range[1], `配置项 ${key} 不可修改或数值越界`);
    }
    return this.transaction(() => {
      this.expireTasks();
      const settings = this.settings(), { version, ...old } = settings, next = { ...old, ...patch };
      const budget = this.db.prepare('SELECT * FROM budgets WHERE day=?').get(dayKey(this.now()));
      assert(!budget || next.dailyBudgetCoins >= budget.spent + budget.reserved, '预算不能低于今日已支出与已承诺奖励之和', 409);
      this.db.prepare('UPDATE settings SET json=?,version=version+1 WHERE id=1').run(JSON.stringify(next));
      this.audit('settings.update', String(version + 1), { before: old, after: next });
      return this.settings();
    });
  }
  updateUser(id, patch) {
    assert(patch && ['active','restricted'].includes(patch.status), '状态格式错误');
    assert(typeof patch.reason === 'string' && patch.reason.trim().length >= 2 && patch.reason.length <= 200, '请填写2—200字处置原因');
    assert(patch.dailyLimit === null || (Number.isInteger(patch.dailyLimit) && patch.dailyLimit >= 0 && patch.dailyLimit <= 100), '每日上限格式错误');
    return this.transaction(() => {
      this.user(id);
      this.db.prepare('UPDATE users SET status=?,daily_limit=? WHERE id=?').run(patch.status, patch.dailyLimit, id);
      this.audit('user.update', id, { status: patch.status, dailyLimit: patch.dailyLimit, reason: patch.reason });
      return this.profile(id);
    });
  }
}
