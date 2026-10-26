import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";

// wx替身驱动原生页面，实际请求临时HTTP服务与SQLite，不替代微信工具或真机。
async function fixture(t, { development = true } = {}) {
  let now = Date.parse("2026-10-25T03:00:00Z"),
    drop = "",
    dropBefore = "",
    gate = null,
    beforeGate = null;
  const store = new YuanxiangStore({
    now: () => now,
    development,
    adProvider: development ? "demo" : "disabled",
  });
  const { server } = createYuanxiangApp({ store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const storage = new Map();
  let user;
  if (!development) {
    const login = store.login("wx:play_native_release_fixture", false);
    storage.set("yx_token", login.token);
    user = login.user;
  }
  const app = {},
    clientModule = { exports: {} };
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal: (options) => options.success({ confirm: true }),
    async request(options) {
      if (beforeGate && options.url.endsWith(beforeGate.path)) {
        const current = beforeGate;
        beforeGate = null;
        current.readyResolve();
        await current.wait;
      }
      if (dropBefore && options.url.endsWith(dropBefore)) {
        dropBefore = "";
        options.fail();
        return;
      }
      fetch(options.url, {
        method: options.method,
        headers: options.header,
        ...(options.method === "GET"
          ? {}
          : { body: JSON.stringify(options.data ?? {}) }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (response.ok && drop && options.url.endsWith(drop)) {
            drop = "";
            options.fail();
            return;
          }
          if (response.ok && gate && options.url.endsWith(gate.path)) {
            const current = gate;
            gate = null;
            current.readyResolve();
            await current.wait;
          }
          options.success({ statusCode: response.status, data });
        })
        .catch(() => options.fail());
    },
  };
  vm.runInNewContext(readFileSync("miniprogram/services/client.js", "utf8"), {
    module: clientModule,
    wx,
    getApp: () => app,
    require: () => ({ API_BASE: base, ENV_VERSION: "develop" }),
    setTimeout: (fn) => {
      queueMicrotask(fn);
    },
  });
  const client = clientModule.exports;
  app.ready = () => app._ready || (app._ready = client.initialize());
  let page;
  vm.runInNewContext(readFileSync("miniprogram/pages/play/index.js", "utf8"), {
    require: () => client,
    getApp: () => app,
    wx,
    Date: { now: () => now },
    setInterval: () => 1,
    clearInterval() {},
    Page: (definition) => {
      page = definition;
    },
  });
  page.setData = function (patch) {
    Object.assign(this.data, patch);
  };
  page._visible = true;
  await page.load();
  if (!user && development) user = await client.request("/api/me");
  t.after(async () => {
    page.leave();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  return {
    page,
    client,
    store,
    user,
    storage,
    advance: (ms) => {
      now += ms;
    },
    dropNext: (path) => {
      drop = path;
    },
    dropBeforeNext: (path) => {
      dropBefore = path;
    },
    holdNext(path) {
      let readyResolve, release;
      const ready = new Promise((resolve) => {
        readyResolve = resolve;
      });
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      gate = { path, readyResolve, wait };
      return { ready, release };
    },
    holdBeforeNext(path) {
      let readyResolve, release;
      const ready = new Promise((resolve) => {
        readyResolve = resolve;
      });
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      beforeGate = { path, readyResolve, wait };
      return { ready, release };
    },
  };
}
const event = (name, value) => ({
  currentTarget: { dataset: { [name]: value } },
});

test("原生趣答真实判题与错题复习，未答答案不暴露，进度可恢复且不发金币", async (t) => {
  const { page, client, store, user } = await fixture(t);
  assert.equal(page.data.enabled, true);
  assert.equal(page.data.records.length, 2);
  await page.openQuiz();
  assert.equal(page.data.question.options.length, 4);
  assert.equal(page.data.question.correctIndex, undefined);
  assert.equal(page.data.quiz.answered, 0);
  const privateQuiz = JSON.parse(
    store.db
      .prepare("SELECT questions_json FROM play_quiz_sessions WHERE id=?")
      .get(page.data.quiz.id).questions_json,
  );
  const wrong = (privateQuiz[0].correctIndex + 1) % 4;
  page.selectChoice(event("index", wrong));
  await page.submitAnswer();
  assert.equal(page.data.answer.correct, false);
  assert.equal(page.data.quiz.answered, 1);
  assert.ok(page.data.answer.explanation);
  const sessionId = page.data.quiz.id;
  await page.back();
  await page.openQuiz();
  assert.equal(page.data.quiz.id, sessionId);
  assert.equal(page.data.quiz.answered, 1);
  assert.notEqual(page.data.question.id, privateQuiz[0].id);
  await page.openReview();
  assert.equal(page.data.review.length, 1);
  page.practice(event("index", 0));
  assert.equal(page.data.answer, null);
  assert.equal(page.data.question.correctIndex, undefined);
  page.selectChoice(event("index", privateQuiz[0].correctIndex));
  await page.submitAnswer();
  assert.equal(page.data.answer.correct, true);
  await page.nextQuestion();
  assert.equal(page.data.review.length, 0);
  const coins = await client.request("/api/me");
  assert.equal(coins.balance, 0);
  assert.equal(store.ledger(user.id).length, 0);
});

test("原生游戏由后端判定每个动作，失去响应后用原actionId恢复，不重复移动", async (t) => {
  const { page, store, storage, user, dropNext } = await fixture(t);
  await page.startGame(event("kind", "merge"));
  assert.equal(page.data.gameCells.length, 16);
  const id = page.data.game.id;
  dropNext("/action");
  await page.move(event("direction", "left"));
  assert.equal(page.data.pending, true);
  assert.ok(storage.get("yx_play_pending_" + user.id));
  assert.equal(store.play.game(user.id, id).revision, 1);
  await page.retryPending();
  assert.equal(page.data.pending, false);
  assert.equal(page.data.game.revision, 1);
  assert.equal(store.play.game(user.id, id).revision, 1);
  assert.equal(storage.has("yx_play_pending_" + user.id), false);
  const snapshot = store.play.game(user.id, id);
  assert.equal(
    JSON.stringify(page.data.game.state.board),
    JSON.stringify(snapshot.state.board),
  );
  await page.back();
  await page.startGame(event("kind", "merge"));
  assert.equal(page.data.game.id, id);
  assert.equal(page.data.gamePaused, false);
  await page.finishGame();
  assert.equal(page.data.game.status, "finished");
  assert.equal(
    store.play.overview(user.id).games.find((g) => g.kind === "merge")
      .lastSession.id,
    id,
  );
  assert.equal(store.profile(user.id).balance, 0);
});

test("原生翻牌仅显示已翻图案；暂停离开不补计，完成记录来自服务器", async (t) => {
  const { page, store, user, advance } = await fixture(t);
  await page.startGame(event("kind", "memory"));
  assert.equal(page.data.gameCells.length, 16);
  assert.ok(page.data.gameCells.every((c) => !c.revealed));
  await page.flip(event("index", 0));
  assert.equal(page.data.gameCells.filter((c) => c.revealed).length, 1);
  advance(4000);
  await page.togglePause();
  assert.equal(page.data.gamePaused, true);
  const pausedAt = page.data.game.elapsedMs;
  advance(60000);
  await page.togglePause();
  assert.equal(page.data.game.elapsedMs, pausedAt);
  const id = page.data.game.id;
  const privateState = JSON.parse(
    store.db.prepare("SELECT state_json FROM play_games WHERE id=?").get(id)
      .state_json,
  );
  const pairIndex = privateState.cards.findIndex(
    (value, index) => index !== 0 && value === privateState.cards[0],
  );
  await page.flip(event("index", pairIndex));
  assert.equal(page.data.gameCells.filter((c) => c.matched).length, 2);
  await page.back();
  assert.equal(store.play.game(user.id, id).paused, true);
  advance(120000);
  await page.startGame(event("kind", "memory"));
  assert.equal(page.data.game.id, id);
  assert.equal(page.data.game.elapsedMs, pausedAt);
  await page.finishGame();
  assert.equal(page.data.game.status, "finished");
  assert.ok(page.data.gameNotice.includes("成绩已保存"));
});

test("原生迟到心跳不能覆盖新棋盘；后台动作回包会再暂停计时", async (t) => {
  const { page, store, user, holdNext } = await fixture(t);
  await page.startGame(event("kind", "merge"));
  const id = page.data.game.id;
  const heartbeatGate = holdNext("/presence");
  const heartbeat = page.setPresence(true);
  await heartbeatGate.ready;
  await page.move(event("direction", "left"));
  assert.equal(page.data.game.revision, 1);
  heartbeatGate.release();
  await heartbeat;
  assert.equal(page.data.game.revision, 1);
  const actionGate = holdNext("/action");
  const moving = page.move(event("direction", "up"));
  await actionGate.ready;
  page.onHide();
  actionGate.release();
  await moving;
  assert.equal(store.play.game(user.id, id).paused, true);
  assert.equal(page.data.gamePaused, true);
});

test("原生生产趣玩关闭，直达页面不创建游戏或奖励", async (t) => {
  const { page, store } = await fixture(t, { development: false });
  assert.equal(page.data.enabled, false);
  await page.startGame(event("kind", "merge"));
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM play_games").get().n,
    0,
  );
});
test("同revision迟到心跳不能覆盖用户刚完成的暂停意图", async (t) => {
  const { page, store, user, advance, holdNext } = await fixture(t);
  await page.startGame(event("kind", "merge"));
  const id = page.data.game.id,
    revision = page.data.game.revision;
  const gate = holdNext("/presence"),
    heartbeat = page.setPresence(true);
  await gate.ready;
  advance(1000);
  await page.togglePause();
  assert.equal(page.data.gamePaused, true);
  gate.release();
  await heartbeat;
  assert.equal(page.data.game.revision, revision);
  assert.equal(page.data.gamePaused, true);
  await page.presence();
  assert.equal(store.play.game(user.id, id).paused, true);
});
test("未知动作未执行且游戏已暂停时，显式查询恢复后只重放原动作一次", async (t) => {
  const { page, store, user, dropBeforeNext } = await fixture(t);
  await page.startGame(event("kind", "merge"));
  const id = page.data.game.id;
  dropBeforeNext("/action");
  await page.move(event("direction", "left"));
  assert.equal(page.data.pending, true);
  assert.equal(store.play.game(user.id, id).revision, 0);
  page.onHide();
  await new Promise((resolve) => setImmediate(resolve));
  page._visible = true;
  await page.load();
  await page.retryPending();
  assert.equal(page.data.pending, false);
  assert.equal(page.data.game.revision, 1);
  assert.equal(store.play.game(user.id, id).revision, 1);
  assert.equal(page.data.gamePaused, false);
});
test("离开再返回期间迟到的新局回包不擅自跳回游戏或恢复后台计时", async (t) => {
  const { page, store, user, holdNext } = await fixture(t);
  const gate = holdNext("/games");
  const starting = page.startGame(event("kind", "merge"));
  await gate.ready;
  page.onHide();
  page._visible = true;
  await page.load();
  gate.release();
  await starting;
  assert.equal(page.data.screen, "hub");
  const game = store.play
    .overview(user.id)
    .games.find((g) => g.kind === "merge").lastSession;
  assert.equal(game.paused, true);
});
test("旧心跳请求晚于离开暂停到达服务器时，补偿暂停且不重启后台计时", async (t) => {
  const { page, store, user, holdBeforeNext } = await fixture(t);
  await page.startGame(event("kind", "merge"));
  const id = page.data.game.id,
    gate = holdBeforeNext("/presence");
  const oldHeartbeat = page.setPresence(true);
  await gate.ready;
  await page.onHide();
  assert.equal(store.play.game(user.id, id).paused, true);
  gate.release();
  await oldHeartbeat;
  assert.equal(page._visible, false);
  assert.equal(page.data.gamePaused, true);
  assert.equal(store.play.game(user.id, id).paused, true);
});
test("暂停请求迟到到达服务器也必须服从更新的恢复意图", async (t) => {
  const { page, store, user, holdBeforeNext } = await fixture(t);
  await page.startGame(event("kind", "merge"));
  const id = page.data.game.id,
    gate = holdBeforeNext("/presence");
  const oldPause = page.setPresence(false);
  await gate.ready;
  await page.setPresence(true);
  gate.release();
  await oldPause;
  assert.equal(page.data.gamePaused, false);
  assert.equal(store.play.game(user.id, id).paused, false);
});
