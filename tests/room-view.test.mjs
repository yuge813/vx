import test from "node:test";
import assert from "node:assert/strict";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { buildRoomMessages } from "../server/room-view.mjs";
function fixture(t, options = {}) {
  let now = Date.parse("2026-10-25T01:00:00Z");
  const store = new YuanxiangStore({ now: () => now, ...options });
  t.after(() => store.close());
  const user = store.login(
    options.development === false
      ? "wx:room_fixture_user"
      : "room_fixture_user",
    options.development !== false,
  ).user.id;
  return { store, user, advance: (ms) => (now += ms) };
}
const packets = (group) =>
  group.messages.filter((row) => row.type === "packet");
test("消息流只展示本账户事件，群人数来自真实账户数，广告位显式标记", (t) => {
  const { store, user } = fixture(t);
  assert.equal(store.group(user).room.memberCount, 1);
  const other = store.login("room_other_user").user.id;
  store.addFeed(other, "redpacket", "另一账户私有事件", 999);
  const group = store.group(user);
  assert.equal(group.room.memberCount, 2);
  assert.equal(
    group.messages.some((row) => row.text === "另一账户私有事件"),
    false,
  );
  assert.equal(packets(group).length, 2);
  assert.ok(packets(group).every((row) => row.bank.coins === 0));
  assert.equal(group.messages.filter((row) => row.type === "ad").length, 1);
  assert.match(
    group.messages.find((row) => row.type === "ad").detail,
    /未接入/,
  );
});
test("叠包后每个奖励池只有一张可操作卡，旧金额转为历史消息", (t) => {
  const { store, user, advance } = fixture(t);
  advance(120000);
  store.group(user);
  store.skip(user, "redpacket");
  advance(120000);
  const group = store.group(user),
    cards = packets(group);
  assert.equal(cards.length, 2);
  assert.ok(cards.every((row) => row.bank.coins === 780));
  assert.ok(
    group.messages.some((row) => row.type === "text" && row.coins === 390),
  );
  assert.equal(new Set(cards.map((row) => row.id)).size, 2);
});
test("领取完成后旧红包消息不可再次操作，当前轮重置且宝箱保留", (t) => {
  const { store, user, advance } = fixture(t);
  advance(120000);
  const old = packets(store.group(user)).find(
    (row) => row.bank.kind === "redpacket",
  );
  const task = store.createTask(user, "redpacket");
  advance(3100);
  store.completeTask(user, task.id);
  const cards = packets(store.group(user)),
    current = cards.find((row) => row.bank.kind === "redpacket");
  assert.notEqual(current.id, old.id);
  assert.equal(current.bank.coins, 0);
  assert.equal(
    cards.find((row) => row.bank.kind === "treasure").bank.coins,
    390,
  );
  assert.equal(store.profile(user).balance, 410);
});
test("即使旧事件移出消息窗口，达到上限的红包仍能继续操作", (t) => {
  const { store, user, advance } = fixture(t);
  advance(23 * 120000);
  let group = store.group(user);
  for (let i = 0; i < 20; i++)
    store.addFeed(user, "notice", "个人任务记录" + i, 0);
  group = store.group(user);
  assert.equal(group.messages.filter((row) => row.type === "text").length, 12);
  assert.equal(packets(group).length, 2);
  assert.ok(packets(group).every((row) => row.bank.coins === 8888));
  const task = store.createTask(user, "redpacket");
  assert.equal(task.base, 8888);
});
test("正式环境消息不包含开发广告占位，构建消息不产生新账务", (t) => {
  const { store, user } = fixture(t, {
    development: false,
    adProvider: "disabled",
  });
  const group = store.group(user),
    before = store.ledger(user);
  assert.equal(
    group.messages.some((row) => row.type === "ad"),
    false,
  );
  buildRoomMessages(group);
  assert.deepEqual(store.ledger(user), before);
});
