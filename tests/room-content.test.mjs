import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
function fixture(t, options = {}) {
  let now = Date.parse("2026-10-25T01:00:00Z");
  const store = new YuanxiangStore({ now: () => now, ...options });
  t.after(() => store.close());
  const login = store.login("room_content_fixture");
  return {
    s: store,
    u: login.user.id,
    token: login.token,
    advance: (ms) => (now += ms),
    step(seconds) {
      let g;
      for (let i = 0; i < seconds; i += 5) {
        now += 5000;
        g = store.group(login.user.id, { roomActive: true });
      }
      return g;
    },
  };
}
const activity = (g) =>
  g.messages.filter((r) => r.avatar && r.type !== "packet");
test("初始化原创角色和消息模板一次，活动助手不计为真实用户", (t) => {
  const { s, u } = fixture(t),
    admin = s.roomContent.admin();
  assert.equal(admin.actors.length, 6);
  assert.equal(admin.messages.length, 6);
  assert.ok(
    admin.actors.every(
      (a) => a.badge === "活动助手" && admin.avatars.includes(a.avatar),
    ),
  );
  const group = s.group(u);
  assert.equal(group.room.memberCount, 1);
  assert.match(group.roomDisclosure, /非真实群友/);
  assert.ok(
    group.messages
      .filter((r) => r.type === "packet")
      .every((r) => r.avatar && r.badge === "活动助手"),
  );
});
test("不同助手按后台顺序和间隔发消息，展示不改变余额与奖励次数", (t) => {
  const { s, u, step } = fixture(t);
  s.group(u, { roomActive: true });
  let g = step(5);
  assert.ok(g.messages.some((r) => r.actor === "桃桃" && r.type === "text"));
  g = step(25);
  assert.ok(g.messages.some((r) => r.actor === "阿禾" && r.type === "packet"));
  assert.equal(g.messages.filter((r) => r.type === "packet").length, 2);
  assert.equal(s.profile(u).balance, 0);
  assert.equal(s.profile(u).adsToday, 0);
  assert.equal(s.ledger(u).length, 0);
});
test("离开和长时间断网暂停消息计时，重新进入不补发离线消息", (t) => {
  const { s, u, advance, step } = fixture(t);
  s.group(u, { roomActive: true });
  step(5);
  const before = activity(s.group(u)).length;
  s.roomContent.pause(u);
  advance(3600000);
  assert.equal(activity(s.group(u, { roomActive: true })).length, before);
  step(20);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM room_posts WHERE user_id=?").get(u)
      .n,
    1,
  );
  step(5);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM room_posts WHERE user_id=?").get(u)
      .n,
    2,
  );
  advance(600000);
  s.group(u, { roomActive: true });
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM room_posts WHERE user_id=?").get(u)
      .n,
    2,
  );
});
test("活动发布按账户隔离，其他账户不继承已发布记录", (t) => {
  const { s, u, step } = fixture(t);
  s.group(u, { roomActive: true });
  step(50);
  const other = s.login("room_content_other").user.id;
  assert.equal(activity(s.group(other)).length, 0);
  assert.ok(activity(s.group(u)).length > 0);
});
test("角色可新增编辑停用删除，并通过版本防止覆盖并发修改", (t) => {
  const { s } = fixture(t);
  let data = s.roomContent.saveActor(null, {
    nickname: "清禾",
    avatar: "avatar-leaf",
    sortOrder: 1,
    enabled: true,
  });
  const actor = data.actors.find((a) => a.nickname === "清禾");
  data = s.roomContent.saveActor(actor.id, {
    version: actor.version,
    nickname: "清禾编辑",
    enabled: false,
  });
  assert.equal(data.actors.find((a) => a.id === actor.id).version, 2);
  assert.throws(
    () =>
      s.roomContent.saveActor(actor.id, {
        version: actor.version,
        nickname: "过期修改",
      }),
    (e) => e.status === 409,
  );
  data = s.roomContent.remove("actor", actor.id, { version: 2 });
  assert.equal(
    data.actors.some((a) => a.id === actor.id),
    false,
  );
  assert.ok(
    s.adminOverview().audit.some((a) => a.action === "room.actor.remove"),
  );
});
test("消息编辑影响未来发布，停用和删除撤下旧消息但不减掉已叠金币", (t) => {
  const { s, u, step, advance } = fixture(t);
  s.group(u, { roomActive: true });
  step(5);
  let m = s.roomContent.admin().messages[0];
  const original = m.content;
  s.roomContent.saveMessage(m.id, {
    version: m.version,
    content: "修改仅影响后续发布",
  });
  assert.ok(s.group(u).messages.some((r) => r.text === original));
  advance(120000);
  s.group(u);
  const coins = s.group(u).banks[0].coins;
  m = s.roomContent.admin().messages.find((x) => x.id === m.id);
  s.roomContent.saveMessage(m.id, { version: m.version, enabled: false });
  assert.equal(
    s.group(u).messages.some((r) => r.text === original),
    false,
  );
  assert.equal(s.group(u).banks[0].coins, coins);
  m = s.roomContent.admin().messages.find((x) => x.id === m.id);
  s.roomContent.remove("message", m.id, { version: m.version });
  assert.equal(
    s.roomContent.admin().messages.some((x) => x.id === m.id),
    false,
  );
});
test("重复红包消息只保留每池一张可领取卡，旧轮记录不能重复发奖", (t) => {
  const { s, u, advance, step } = fixture(t);
  const data = s.roomContent.admin();
  for (const m of data.messages)
    s.roomContent.saveMessage(m.id, { version: m.version, enabled: false });
  data.actors
    .slice(0, 3)
    .forEach((actor, i) =>
      s.roomContent.saveMessage(null, {
        actorId: actor.id,
        kind: "redpacket",
        content: "活动红包" + i,
        delaySeconds: 5,
        sortOrder: i,
        enabled: true,
      }),
    );
  advance(120000);
  s.group(u, { roomActive: true });
  const g = step(20);
  assert.equal(g.messages.filter((r) => r.type === "packet").length, 2);
  assert.ok(g.messages.filter((r) => r.type === "packet_history").length >= 2);
  const packet = g.messages.find(
    (r) => r.type === "packet" && r.bank.kind === "redpacket",
  );
  assert.equal(packet.bank.coins, 390);
  const task = s.createTask(u, "redpacket");
  advance(3100);
  s.completeTask(u, task.id);
  const next = s.group(u);
  assert.equal(
    next.messages.find(
      (r) => r.type === "packet" && r.bank.kind === "redpacket",
    ).bank.coins,
    0,
  );
  assert.equal(s.profile(u).balance, 410);
  s.completeTask(u, task.id);
  assert.equal(s.profile(u).balance, 410);
});
test("停用角色撤下其消息、停止后续发布，其他角色照常工作", (t) => {
  const { s, u, step } = fixture(t);
  s.group(u, { roomActive: true });
  step(5);
  const actor = s.roomContent.admin().actors[0];
  s.roomContent.saveActor(actor.id, { version: actor.version, enabled: false });
  assert.equal(
    s.group(u).messages.some((r) => r.actor === actor.nickname),
    false,
  );
  step(40);
  assert.equal(
    s.group(u).messages.some((r) => r.actor === actor.nickname),
    false,
  );
  assert.ok(s.group(u).messages.some((r) => r.badge === "活动助手"));
});
test("无效头像、超长文本、无效间隔、伪造类型及未知配置被拒绝", (t) => {
  const { s } = fixture(t),
    actor = s.roomContent.admin().actors[0];
  for (const patch of [
    { nickname: "x", avatar: "https://untrusted/avatar.svg" },
    { nickname: "x", enabled: 1 },
    { nickname: "x".repeat(17) },
    { nickname: "x", onlineUsers: 999 },
  ])
    assert.throws(() => s.roomContent.saveActor(null, patch));
  for (const patch of [
    { delaySeconds: 1 },
    { kind: "cash" },
    { content: "x".repeat(241) },
    { actorId: "unknown" },
  ])
    assert.throws(() =>
      s.roomContent.saveMessage(null, {
        actorId: actor.id,
        kind: "text",
        content: "正常消息",
        delaySeconds: 10,
        enabled: true,
        sortOrder: 0,
        ...patch,
      }),
    );
});
test("数据库重启保留角色、模板和发布记录，不重复初始化或回放离线消息", () => {
  const dir = mkdtempSync(join(tmpdir(), "room-content-")),
    path = join(dir, "room.sqlite");
  let now = Date.parse("2026-10-25T01:00:00Z"),
    s;
  try {
    s = new YuanxiangStore({ path, now: () => now });
    const u = s.login("room_restart_fixture").user.id;
    s.group(u, { roomActive: true });
    now += 5000;
    s.group(u, { roomActive: true });
    const id = s.roomContent.admin().actors[0].id;
    s.close();
    now += 3600000;
    s = new YuanxiangStore({ path, now: () => now });
    assert.equal(s.roomContent.admin().actors.length, 6);
    assert.equal(s.roomContent.admin().actors[0].id, id);
    assert.equal(activity(s.group(u, { roomActive: true })).length, 1);
  } finally {
    s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP后台管理鉴权、真实保存和前台发布使用同一数据", async (t) => {
  const { s, u, token, advance } = fixture(t),
    admin = "a".repeat(40),
    { server } = createYuanxiangApp({ store: s, adminToken: admin });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (path, method = "GET", body, auth = admin) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + auth,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  assert.equal(
    (await request("/api/admin/room-content", "GET", null, token)).status,
    401,
  );
  const listing = (await request("/api/admin/room-content")).data;
  let r = await request("/api/admin/room/actors", "POST", {
    nickname: "接口助手",
    avatar: "avatar-moon",
    enabled: true,
    sortOrder: 5,
  });
  assert.equal(r.status, 200);
  const actor = r.data.actors.find((a) => a.nickname === "接口助手");
  r = await request("/api/admin/room/messages", "POST", {
    actorId: actor.id,
    kind: "text",
    content: "后台新增已持久化",
    delaySeconds: 5,
    sortOrder: 0,
    enabled: true,
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.messages.some((m) => m.content === "后台新增已持久化"));
  assert.equal(
    (
      await request(
        "/api/admin/room/messages",
        "POST",
        {
          actorId: actor.id,
          kind: "text",
          content: "无权发布",
          delaySeconds: 5,
        },
        token,
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/api/group?active=1", "GET", null, token)).status,
    200,
  );
  advance(5000);
  await request("/api/group?active=1", "GET", null, token);
  assert.equal(
    (await request("/api/group/presence", "POST", { active: false }, token))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/group/presence", "POST", { active: true }, token))
      .status,
    400,
  );
  assert.equal(s.profile(u).balance, 0);
  assert.equal(listing.actors.length, 6);
});
