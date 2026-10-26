import test from "node:test";
import assert from "node:assert/strict";
import games from "../shared/play-games.cjs";
const {
  createMerge,
  moveMerge,
  createMemory,
  flipMemory,
  publicMemory,
  settleMemory,
} = games;
const state = (board) => ({
  kind: "merge",
  board,
  score: 0,
  moves: 0,
  won: false,
  over: false,
});
test("数字合成每次每格只合并一次，原棋盘不变", () => {
  const before = state([2, 2, 4, 0, ...Array(12).fill(0)]),
    copy = structuredClone(before);
  const after = moveMerge(before, "left", () => 0);
  assert.deepEqual(after.board.slice(0, 4), [4, 4, 2, 0]);
  assert.equal(after.score, 4);
  assert.equal(after.moves, 1);
  assert.deepEqual(before, copy);
  const double = moveMerge(
    state([2, 2, 2, 2, ...Array(12).fill(0)]),
    "left",
    () => 0,
  );
  assert.deepEqual(double.board.slice(0, 4), [4, 4, 2, 0]);
  assert.equal(double.score, 8);
});
test("四个方向计算、无效移动与新生方块正确", () => {
  const before = state([0, 2, 0, 0, ...Array(12).fill(0)]);
  assert.equal(moveMerge(before, "left", () => 0).board[0], 2);
  assert.equal(moveMerge(before, "right", () => 0).board[3], 2);
  assert.equal(moveMerge(before, "down", () => 0).board[13], 2);
  let calls = 0;
  const unchanged = moveMerge(before, "up", () => {
    calls++;
    return 0;
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.moves, 0);
  assert.equal(calls, 0);
  assert.equal(createMerge(() => 0).board.filter(Boolean).length, 2);
});
test("数字达2048可继续，棋盘无路可走才结束", () => {
  const win = moveMerge(
    state([1024, 1024, ...Array(14).fill(0)]),
    "left",
    () => 0,
  );
  assert.equal(win.won, true);
  assert.equal(win.over, false);
  assert.equal(win.score, 2048);
  const full = state([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]);
  const end = moveMerge(full, "left", () => {
    throw new Error("不应新增方块");
  });
  assert.equal(end.over, true);
  assert.equal(end.changed, false);
  assert.throws(() => moveMerge(full, "diagonal"), /方向/);
  assert.throws(() => createMerge(() => 1), /随机源/);
});
test("记忆牌组每种恰好两张且公共数据不泄露暗牌", () => {
  const before = createMemory(() => 0.3, 8);
  assert.equal(before.cards.length, 16);
  for (let i = 0; i < 8; i++)
    assert.equal(before.cards.filter((v) => v === i).length, 2);
  assert.ok(publicMemory(before).cards.every((v) => v === null));
  const after = flipMemory(before, 0);
  assert.equal(publicMemory(after).cards.filter((v) => v !== null).length, 1);
  assert.equal(before.open.length, 0);
  const match = before.cards.findIndex(
    (v, i) => i !== 0 && v === before.cards[0],
  );
  const paired = flipMemory(after, match);
  assert.equal(paired.matched.length, 2);
  assert.equal(paired.score, 100);
  assert.equal(paired.attempts, 1);
  const repeated = flipMemory(paired, 0);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.moves, 2);
});
test("记忆配错只显露两张，第三次点击先清理，不重复计分", () => {
  const start = createMemory(() => 0.2, 8),
    a = 0,
    b = start.cards.findIndex((v) => v !== start.cards[0]);
  const miss = flipMemory(flipMemory(start, a), b);
  assert.equal(miss.phase, "miss");
  assert.equal(miss.open.length, 2);
  assert.equal(miss.score, 0);
  const third = flipMemory(miss, a);
  assert.deepEqual(third.open, [a]);
  assert.equal(third.attempts, 1);
  assert.equal(third.moves, 3);
  assert.deepEqual(settleMemory(miss).open, []);
});
test("记忆全部配对完成，之后翻牌不能修改已完成成绩", () => {
  let current = createMemory(() => 0.1, 8);
  for (let value = 0; value < 8; value++)
    for (const index of current.cards
      .map((v, i) => (v === value ? i : -1))
      .filter((i) => i >= 0))
      current = flipMemory(current, index);
  assert.equal(current.won, true);
  assert.equal(current.over, true);
  assert.equal(current.score, 800);
  assert.equal(current.phase, "complete");
  assert.equal(flipMemory(current, 0).moves, 16);
  assert.throws(() => flipMemory(current, 99), /位置/);
});
