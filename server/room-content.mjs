import { randomUUID } from "node:crypto";
import { AppError } from "./store.mjs";
export const roomAvatars = [
  "avatar-peach",
  "avatar-leaf",
  "avatar-cat",
  "avatar-river",
  "avatar-sun",
  "avatar-moon",
];
const need = (value, message, status = 400) => {
  if (!value) throw new AppError(message, status, "ROOM_CONTENT_INVALID");
};
const text = (value, max, name) => {
  need(
    typeof value === "string" &&
      value.trim().length > 0 &&
      Array.from(value.trim()).length <= max,
    `${name}需1—${max}字`,
  );
  return value.trim();
};
const integer = (value, min, max, name) => {
  need(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${name}需${min}—${max}整数`,
  );
  return value;
};
const boolean = (value) => {
  need(typeof value === "boolean", "启用状态需布尔值");
  return value ? 1 : 0;
};
const own = (o, key) => Object.hasOwn(o, key);
export class RoomContent {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_content_meta(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS room_actors(id TEXT PRIMARY KEY,nickname TEXT NOT NULL,avatar TEXT NOT NULL,enabled INTEGER NOT NULL,sort_order INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS room_templates(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES room_actors(id),kind TEXT NOT NULL,content TEXT NOT NULL,delay_seconds INTEGER NOT NULL,enabled INTEGER NOT NULL,sort_order INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS room_clocks(user_id TEXT PRIMARY KEY REFERENCES users(id),elapsed_ms INTEGER NOT NULL,last_seen INTEGER,cursor INTEGER NOT NULL,next_due_ms INTEGER NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS room_posts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),template_id TEXT NOT NULL REFERENCES room_templates(id),actor_id TEXT NOT NULL REFERENCES room_actors(id),actor_name TEXT NOT NULL,avatar TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,bank_generation TEXT,coins INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS room_posts_user_time ON room_posts(user_id,created_at DESC);
    `);
    if (!this.db.prepare("SELECT 1 FROM room_content_meta WHERE id=1").get())
      store.transaction(() => {
        this.db.prepare("INSERT INTO room_content_meta VALUES(1,1)").run();
        const people = ["桃桃", "阿禾", "小满", "星河", "橙子", "木木"];
        const ids = people.map((nickname, i) => {
          const id = randomUUID();
          this.db
            .prepare(
              "INSERT INTO room_actors(id,nickname,avatar,enabled,sort_order) VALUES(?,?,?,1,?)",
            )
            .run(id, nickname, roomAvatars[i], i * 10);
          return id;
        });
        const examples = [
          ["text", "欢迎来到金币活动群，活动消息由助手按安排发布。", 5],
          ["redpacket", "积少成多，今天也有小收获", 25],
          ["text", "红包可以先看金额，暂不打开会继续累计。", 20],
          ["treasure", "宝箱慢慢积累，小惊喜等你开", 30],
          ["redpacket", "给认真生活的你，一份小惊喜", 40],
          ["text", "领取记录随时可查，关闭广告位不影响红包累计。", 20],
        ];
        examples.forEach(([kind, content, delay], i) =>
          this.db
            .prepare(
              "INSERT INTO room_templates(id,actor_id,kind,content,delay_seconds,enabled,sort_order) VALUES(?,?,?,?,?,1,?)",
            )
            .run(randomUUID(), ids[i], kind, content, delay, i * 10),
        );
      });
  }
  revision() {
    return this.db
      .prepare("SELECT revision FROM room_content_meta WHERE id=1")
      .get().revision;
  }
  actor(row) {
    return {
      id: row.id,
      nickname: row.nickname,
      avatar: row.avatar,
      enabled: !!row.enabled,
      sortOrder: row.sort_order,
      version: row.version,
      badge: "活动助手",
    };
  }
  template(row) {
    return {
      id: row.id,
      actorId: row.actor_id,
      kind: row.kind,
      content: row.content,
      delaySeconds: row.delay_seconds,
      enabled: !!row.enabled,
      sortOrder: row.sort_order,
      version: row.version,
    };
  }
  admin() {
    return {
      revision: this.revision(),
      avatars: roomAvatars,
      actors: this.db
        .prepare(
          "SELECT * FROM room_actors WHERE deleted=0 ORDER BY sort_order,id",
        )
        .all()
        .map((r) => this.actor(r)),
      messages: this.db
        .prepare(
          "SELECT * FROM room_templates WHERE deleted=0 ORDER BY sort_order,id",
        )
        .all()
        .map((r) => this.template(r)),
      notice:
        "角色统一标识为活动助手；按排序循环发布。编辑影响后续发布，停用或删除会撤下该角色或模板的已发活动消息；不影响用户已叠金币。",
    };
  }
  validPatch(patch, allowed) {
    need(
      patch && Object.getPrototypeOf(patch) === Object.prototype,
      "消息配置格式错误",
    );
    need(
      Object.keys(patch).length > 0 &&
        Object.keys(patch).every((k) => allowed.includes(k)),
      "消息配置包含未知字段",
    );
  }
  changed(action, id, detail) {
    this.db
      .prepare("UPDATE room_content_meta SET revision=revision+1 WHERE id=1")
      .run();
    this.store.audit(action, id, detail);
  }
  saveActor(id, patch) {
    this.validPatch(patch, [
      "version",
      "nickname",
      "avatar",
      "enabled",
      "sortOrder",
    ]);
    return this.store.transaction(() => {
      const old = id
        ? this.db
            .prepare("SELECT * FROM room_actors WHERE id=? AND deleted=0")
            .get(id)
        : null;
      if (id) {
        need(old, "活动助手不存在", 404);
        need(
          patch.version === old.version,
          "活动助手已被修改，请刷新后重试",
          409,
        );
      } else
        need(
          this.db
            .prepare("SELECT COUNT(*) AS n FROM room_actors WHERE deleted=0")
            .get().n < 50,
          "最多50个活动助手",
        );
      const value = {
        ...(old
          ? this.actor(old)
          : { enabled: true, sortOrder: 0, avatar: roomAvatars[0] }),
        ...patch,
      };
      value.nickname = text(value.nickname, 16, "昵称");
      need(roomAvatars.includes(value.avatar), "请选择已提供的原创头像");
      value.enabled = boolean(value.enabled);
      value.sortOrder = integer(value.sortOrder, 0, 10000, "排序");
      const key = id || randomUUID();
      if (old)
        this.db
          .prepare(
            "UPDATE room_actors SET nickname=?,avatar=?,enabled=?,sort_order=?,version=version+1 WHERE id=?",
          )
          .run(
            value.nickname,
            value.avatar,
            value.enabled,
            value.sortOrder,
            key,
          );
      else
        this.db
          .prepare(
            "INSERT INTO room_actors(id,nickname,avatar,enabled,sort_order) VALUES(?,?,?,?,?)",
          )
          .run(
            key,
            value.nickname,
            value.avatar,
            value.enabled,
            value.sortOrder,
          );
      this.changed(old ? "room.actor.update" : "room.actor.create", key, {
        before: old ? this.actor(old) : null,
        after: value,
      });
      return this.admin();
    });
  }
  saveMessage(id, patch) {
    this.validPatch(patch, [
      "version",
      "actorId",
      "kind",
      "content",
      "delaySeconds",
      "enabled",
      "sortOrder",
    ]);
    return this.store.transaction(() => {
      const old = id
        ? this.db
            .prepare("SELECT * FROM room_templates WHERE id=? AND deleted=0")
            .get(id)
        : null;
      if (id) {
        need(old, "活动消息不存在", 404);
        need(
          patch.version === old.version,
          "活动消息已被修改，请刷新后重试",
          409,
        );
      } else
        need(
          this.db
            .prepare("SELECT COUNT(*) AS n FROM room_templates WHERE deleted=0")
            .get().n < 200,
          "最多200条活动消息模板",
        );
      const value = {
        ...(old
          ? this.template(old)
          : { kind: "text", delaySeconds: 20, enabled: true, sortOrder: 0 }),
        ...patch,
      };
      need(
        typeof value.actorId === "string" &&
          this.db
            .prepare("SELECT 1 FROM room_actors WHERE id=? AND deleted=0")
            .get(value.actorId),
        "请选择有效的活动助手",
      );
      need(
        ["text", "redpacket", "treasure"].includes(value.kind),
        "活动消息类型错误",
      );
      value.content = text(value.content, 240, "消息内容");
      value.delaySeconds = integer(value.delaySeconds, 5, 3600, "间隔秒");
      value.sortOrder = integer(value.sortOrder, 0, 10000, "排序");
      value.enabled = boolean(value.enabled);
      const key = id || randomUUID();
      if (old)
        this.db
          .prepare(
            "UPDATE room_templates SET actor_id=?,kind=?,content=?,delay_seconds=?,enabled=?,sort_order=?,version=version+1 WHERE id=?",
          )
          .run(
            value.actorId,
            value.kind,
            value.content,
            value.delaySeconds,
            value.enabled,
            value.sortOrder,
            key,
          );
      else
        this.db
          .prepare(
            "INSERT INTO room_templates(id,actor_id,kind,content,delay_seconds,enabled,sort_order) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            key,
            value.actorId,
            value.kind,
            value.content,
            value.delaySeconds,
            value.enabled,
            value.sortOrder,
          );
      this.changed(old ? "room.message.update" : "room.message.create", key, {
        before: old ? this.template(old) : null,
        after: value,
      });
      return this.admin();
    });
  }
  remove(type, id, patch) {
    this.validPatch(patch, ["version"]);
    const table = type === "actor" ? "room_actors" : "room_templates";
    return this.store.transaction(() => {
      const row = this.db
        .prepare(`SELECT * FROM ${table} WHERE id=? AND deleted=0`)
        .get(id);
      need(row, "活动内容不存在", 404);
      need(
        patch.version === row.version,
        "活动内容已被修改，请刷新后重试",
        409,
      );
      this.db
        .prepare(
          `UPDATE ${table} SET enabled=0,deleted=1,version=version+1 WHERE id=?`,
        )
        .run(id);
      this.changed(`room.${type}.remove`, id, { before: row });
      return this.admin();
    });
  }
  pause(userId) {
    this.db
      .prepare("UPDATE room_clocks SET last_seen=NULL WHERE user_id=?")
      .run(userId);
    return { paused: true };
  }
  read(userId, banks, active) {
    const now = this.store.now(),
      revision = this.revision();
    const templates = this.db
      .prepare(
        "SELECT t.*,a.nickname,a.avatar FROM room_templates t JOIN room_actors a ON a.id=t.actor_id WHERE t.enabled=1 AND t.deleted=0 AND a.enabled=1 AND a.deleted=0 ORDER BY t.sort_order,t.id",
      )
      .all();
    if (active && templates.length) {
      let clock = this.db
        .prepare("SELECT * FROM room_clocks WHERE user_id=?")
        .get(userId);
      if (!clock || clock.revision !== revision) {
        this.db
          .prepare(
            "INSERT INTO room_clocks VALUES(?,0,?,0,?,?) ON CONFLICT(user_id) DO UPDATE SET elapsed_ms=0,last_seen=excluded.last_seen,cursor=0,next_due_ms=excluded.next_due_ms,revision=excluded.revision",
          )
          .run(userId, now, templates[0].delay_seconds * 1000, revision);
        clock = this.db
          .prepare("SELECT * FROM room_clocks WHERE user_id=?")
          .get(userId);
      }
      const delta = clock.last_seen === null ? 0 : now - clock.last_seen;
      const elapsed =
        clock.elapsed_ms + (delta >= 0 && delta <= 10000 ? delta : 0);
      let cursor = clock.cursor % templates.length,
        nextDue = clock.next_due_ms;
      // 每个心跳至多发布一条；不会为离线时间补出一串旧消息。
      if (elapsed >= nextDue) {
        const item = templates[cursor],
          bank = banks.find((b) => b.kind === item.kind);
        this.db
          .prepare(
            "INSERT INTO room_posts(id,user_id,template_id,actor_id,actor_name,avatar,kind,content,bank_generation,coins,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            userId,
            item.id,
            item.actor_id,
            item.nickname,
            item.avatar,
            item.kind,
            item.content,
            bank?.generation || null,
            bank?.coins || 0,
            now,
          );
        cursor = (cursor + 1) % templates.length;
        nextDue = elapsed + templates[cursor].delay_seconds * 1000;
        // 仅保留每个账户最近100条运营消息，审计单独保留；不删除金币流水。
        this.db
          .prepare(
            "DELETE FROM room_posts WHERE user_id=? AND id NOT IN (SELECT id FROM room_posts WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)",
          )
          .run(userId, userId);
      }
      this.db
        .prepare(
          "UPDATE room_clocks SET elapsed_ms=?,last_seen=?,cursor=?,next_due_ms=? WHERE user_id=?",
        )
        .run(elapsed, now, cursor, nextDue, userId);
    }
    const posts = this.db
      .prepare(
        "SELECT p.* FROM room_posts p JOIN room_templates t ON t.id=p.template_id JOIN room_actors a ON a.id=p.actor_id WHERE p.user_id=? AND t.enabled=1 AND t.deleted=0 AND a.enabled=1 AND a.deleted=0 ORDER BY p.created_at DESC,p.rowid DESC LIMIT 24",
      )
      .all(userId)
      .reverse()
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        text: p.content,
        actor: p.actor_name,
        avatar: p.avatar,
        badge: "活动助手",
        bankGeneration: p.bank_generation,
        coins: p.coins,
        createdAt: p.created_at,
      }));
    return {
      actors: this.db
        .prepare(
          "SELECT * FROM room_actors WHERE enabled=1 AND deleted=0 ORDER BY sort_order,id",
        )
        .all()
        .map((r) => this.actor(r)),
      posts,
      disclosure: "活动助手由运营方管理，非真实群友聊天。",
    };
  }
}
