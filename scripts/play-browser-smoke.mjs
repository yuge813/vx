// 趣玩整合浏览器验收：真实HTTP与真实指针操作，使用独立临时数据库。
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { openBrowser, pause } from "./browser-utils.mjs";
import games from "../shared/play-games.cjs";

let clockOffset = 0;
const store = new YuanxiangStore({ now: () => Date.now() + clockOffset });
const { server } = createYuanxiangApp({ store });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let b;
try {
  b = await openBrowser("http://127.0.0.1:" + server.address().port, 390, 844);
  await b.viewport(390, 844, true);
  const waitFor = async (fn, label) => {
    for (let i = 0; i < 200; i++) {
      if (await fn()) return;
      await pause(50);
    }
    throw new Error("趣玩状态未满足：" + label);
  };
  const shot = async (name) => {
    if (process.argv.includes("--screenshots"))
      await b.screenshot(resolve("docs/screenshots/play", name + ".png"));
  };
  const click = async (selector, { duringPlayWrite = false } = {}) => {
    if (!duringPlayWrite)
      await b.until(
        "document.querySelector('#play-root')?.getAttribute('aria-busy')!=='true'",
      );
    await b.until(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
    await b.until(
      `!document.querySelector(${JSON.stringify(selector)}).disabled`,
    );
    const point = await b.evaluate(
      `(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await b.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await b.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  };
  const layout = async (name) => {
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [600, 844],
    ]) {
      await b.viewport(width, height, true);
      assert.equal(
        await b.evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        name + "横向溢出" + width,
      );
    }
    await b.viewport(390, 844, true);
  };
  await b.until("Boolean(document.querySelector('[data-nav=play]'))");
  const userId = store.adminOverview().users[0].id;
  await click("[data-nav=play]");
  await b.until("Boolean(document.querySelector('[data-play-open=quiz]'))");
  await layout("趣玩大厅");
  await shot("mobile-hub");

  await click("[data-play-open=quiz]");
  await b.until("Boolean(document.querySelector('[data-play-answer]'))");
  await layout("每日趣答");
  await shot("mobile-quiz");
  // 逐题真实提交；后端已答结果用于核对，题目正确答案不由前端预先取得。
  let seenWrong = false;
  for (let i = 0; i < 5; i++) {
    const currentQuiz = store.play.quiz(userId);
    const snapshot = JSON.parse(
      store.db
        .prepare("SELECT questions_json FROM play_quiz_sessions WHERE id=?")
        .get(currentQuiz.id).questions_json,
    );
    const current = snapshot[currentQuiz.answered];
    assert.equal(
      "correctIndex" in currentQuiz.current,
      false,
      "未答题目公开API不能泄露答案",
    );
    const choice =
      i === 0 ? (current.correctIndex + 1) % 4 : current.correctIndex;
    await click('[data-play-answer="' + choice + '"]');
    await b.until("Boolean(document.querySelector('[data-play-next]'))");
    const quiz = store.play.quiz(userId);
    assert.equal(quiz.answered, i + 1);
    if (quiz.results.some((answer) => !answer.correct)) seenWrong = true;
    if (i === 0) await shot("mobile-quiz-answer");
    await click("[data-play-next]");
  }
  const completed = store.play.quiz(userId);
  assert.equal(completed.completed, true);
  await shot("mobile-quiz-complete");
  await click("[data-play-back]");
  await click("[data-play-mistakes]");
  await layout("错题记录");
  if (seenWrong) {
    assert.ok(store.play.mistakes(userId).items.length > 0);
    await shot("mobile-mistakes");
    const mistake = store.play.mistakes(userId).items[0];
    const snapshot = JSON.parse(
      store.db
        .prepare(
          "SELECT question_json FROM play_mistakes WHERE user_id=? AND question_id=?",
        )
        .get(userId, mistake.id).question_json,
    );
    await click('[data-play-review="' + mistake.id + '"]');
    await click('[data-play-answer="' + snapshot.correctIndex + '"]');
    await b.until("Boolean(document.querySelector('[data-play-next]'))");
    await click("[data-play-next]");
    assert.equal(
      store.play.mistakes(userId).items.length,
      0,
      "答对复习后移出待复习列表",
    );
  }
  await click("[data-play-back]");

  const lastGame = (kind) =>
    store.db
      .prepare(
        "SELECT * FROM play_games WHERE user_id=? AND kind=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(userId, kind);
  const stateOf = (row) => JSON.parse(row.state_json);
  await click("[data-play-open=merge]");
  await b.until("Boolean(document.querySelector('[data-play-direction]'))");
  let merge = lastGame("merge");
  assert.ok(merge);
  await layout("数字合成");
  await shot("mobile-merge");
  let direction = games.directions.find(
    (d) => games.moveMerge(stateOf(merge), d, () => 0.1).changed,
  );
  assert.ok(direction);
  const previousRevision = merge.revision;
  await click('[data-play-direction="' + direction + '"]');
  await waitFor(
    () => lastGame("merge").revision > previousRevision,
    "数字合成方向按钮",
  );
  merge = lastGame("merge");
  // 棋盘焦点内方向键与触屏滑动也必须调用服务器动作。
  direction = games.directions.find(
    (d) => games.moveMerge(stateOf(merge), d, () => 0.1).changed,
  );
  await b.evaluate("document.querySelector('[data-play-board=merge]').focus()");
  const arrow = {
    left: ["ArrowLeft", 37],
    up: ["ArrowUp", 38],
    right: ["ArrowRight", 39],
    down: ["ArrowDown", 40],
  }[direction];
  await b.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: arrow[0],
    code: arrow[0],
    windowsVirtualKeyCode: arrow[1],
    nativeVirtualKeyCode: arrow[1],
  });
  await b.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: arrow[0],
    code: arrow[0],
    windowsVirtualKeyCode: arrow[1],
    nativeVirtualKeyCode: arrow[1],
  });
  await waitFor(
    () => lastGame("merge").revision > merge.revision,
    "数字合成方向键",
  );
  merge = lastGame("merge");
  await b.until(
    "document.querySelector('#play-root').getAttribute('aria-busy')==='false'",
  );
  direction = games.directions.find(
    (d) => games.moveMerge(stateOf(merge), d, () => 0.1).changed,
  );
  const rect = await b.evaluate(
    "(()=>{const r=document.querySelector('[data-play-board=merge]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  const delta = { left: [-70, 0], right: [70, 0], up: [0, -70], down: [0, 70] }[
    direction
  ];
  await b.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...rect, id: 1 }],
  });
  await b.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: rect.x + delta[0], y: rect.y + delta[1], id: 1 }],
  });
  await b.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await waitFor(
    () => lastGame("merge").revision > merge.revision,
    "数字合成触屏滑动",
  );
  merge = lastGame("merge");
  // 请求已提交但回包丢失，页面须查询/重试同一动作，不能重复执行。
  direction = games.directions.find(
    (d) => games.moveMerge(stateOf(merge), d, () => 0.1).changed,
  );
  await b.evaluate(
    "(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/play/games/')&&String(args[0]).endsWith('/action')&&response.ok){window.fetch=original;throw new TypeError('验收：动作已提交后的响应丢失');}return response;};})()",
  );
  await click('[data-play-direction="' + direction + '"]');
  await b.until("Boolean(document.querySelector('[data-play-retry]'))");
  const afterLost = lastGame("merge");
  assert.equal(afterLost.revision, merge.revision + 1);
  await shot("mobile-network-recovery");
  await click("[data-play-retry]");
  await b.until(
    "Boolean(document.querySelector('[data-play-direction]:not([disabled])'))",
  );
  assert.equal(lastGame("merge").revision, afterLost.revision);
  assert.deepEqual(stateOf(lastGame("merge")).board, stateOf(afterLost).board);
  // 动作尚未送达就断网，随后棋局被暂停：明确查询恢复须能重放原动作，不能409死锁。
  merge = lastGame("merge");
  direction = games.directions.find(
    (d) => games.moveMerge(stateOf(merge), d, () => 0.1).changed,
  );
  await b.evaluate(
    "(()=>{const original=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('/api/play/games/')&&String(args[0]).endsWith('/action')){window.fetch=original;throw new TypeError('验收：请求尚未送达');}return original(...args);};})()",
  );
  await click('[data-play-direction="' + direction + '"]');
  await b.until("Boolean(document.querySelector('[data-play-retry]'))");
  assert.equal(lastGame("merge").revision, merge.revision);
  store.play.presence(userId, merge.id, false);
  await click("[data-play-retry]");
  await b.until(
    "Boolean(document.querySelector('[data-play-direction]:not([disabled])'))",
  );
  assert.equal(lastGame("merge").revision, merge.revision + 1);
  await click("[data-play-back]");
  await click("[data-play-open=merge]");
  await b.until("Boolean(document.querySelector('[data-play-direction]'))");
  assert.equal(lastGame("merge").id, merge.id, "重新进入恢复原棋局");
  // 旧心跳在真正发往服务器前被延迟；显式暂停先提交，旧true随后到达也必须纠正。
  await b.evaluate(
    "(()=>{const original=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/presence')&&JSON.parse(args[1]?.body||'{}').active===true){window.fetch=original;await new Promise(resolve=>window.__releaseOldPlayPresence=resolve);const response=await original(...args);window.__oldPlayPresenceDelivered=true;return response;}return original(...args);};})()",
  );
  await b.until("typeof window.__releaseOldPlayPresence==='function'");
  await click("[data-play-pause]");
  await b.until("Boolean(document.querySelector('[data-play-resume]'))");
  assert.equal(lastGame("merge").last_seen, null);
  await b.evaluate("window.__releaseOldPlayPresence()");
  await b.until("window.__oldPlayPresenceDelivered===true");
  await waitFor(
    () => lastGame("merge").last_seen === null,
    "晚到服务器的旧心跳按最新暂停意图纠正",
  );
  await b.until("Boolean(document.querySelector('[data-play-resume]'))");
  await click("[data-play-resume]");
  await b.until("Boolean(document.querySelector('[data-play-pause]'))");
  await click("[data-play-back]");

  await click("[data-play-open=memory]");
  await b.until("Boolean(document.querySelector('[data-play-card]'))");
  let memory = lastGame("memory");
  assert.ok(memory);
  await layout("记忆翻牌");
  await shot("mobile-memory");
  await click("[data-play-pause]");
  await b.until("Boolean(document.querySelector('[data-play-resume]'))");
  const paused = lastGame("memory");
  clockOffset += 20000;
  await click("[data-play-resume]");
  await b.until("Boolean(document.querySelector('[data-play-pause]'))");
  assert.equal(
    lastGame("memory").elapsed_ms,
    paused.elapsed_ms,
    "暂停的20秒不计入用时",
  );
  // 仅验收进程读取临时库的私有牌组以稳定驱动完整配对；客户端API必须隐藏暗牌。
  const cards = stateOf(memory).cards;
  const pairs = new Map();
  cards.forEach((card, index) =>
    pairs.set(card, [...(pairs.get(card) || []), index]),
  );
  for (const indices of pairs.values()) {
    let revision = lastGame("memory").revision;
    await click('[data-play-card="' + indices[0] + '"]');
    await waitFor(() => lastGame("memory").revision > revision, "翻开第一张");
    revision = lastGame("memory").revision;
    await click('[data-play-card="' + indices[1] + '"]');
    await waitFor(() => lastGame("memory").revision > revision, "配对第二张");
  }
  memory = lastGame("memory");
  assert.equal(stateOf(memory).won, true);
  assert.equal(stateOf(memory).matched.length, 16);
  await shot("mobile-memory-complete");
  await click("[data-play-back]");
  // 创建回包迟到时用户已点主导航离开：旧页面必须暂停新棋局，不能在后台resume。
  await b.evaluate(
    "(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0])==='/api/play/games'&&args[1]?.method==='POST'){window.fetch=original;await new Promise(resolve=>window.__releasePlayCreate=resolve);}return response;};})()",
  );
  await click("[data-play-open=memory]");
  await b.until("typeof window.__releasePlayCreate==='function'");
  const lateGame = lastGame("memory");
  await click("#navigation [data-nav=home]", { duringPlayWrite: true });
  await b.until("!document.querySelector('#play-root')");
  await b.evaluate("window.__releasePlayCreate()");
  await waitFor(
    () =>
      lastGame("memory").id === lateGame.id &&
      lastGame("memory").last_seen === null,
    "离开后迟到创建棋局被暂停",
  );
  // 初始化overview回包迟到时，也不能在已销毁控制器上创建新定时器。
  await b.evaluate(
    "(()=>{const original=window.fetch;const interval=window.setInterval;window.__latePlayTimers=0;window.__restorePlayTimers=()=>window.setInterval=interval;window.setInterval=(...args)=>{window.__latePlayTimers++;return interval(...args);};window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0])==='/api/play/overview'){window.fetch=original;await new Promise(resolve=>window.__releasePlayOverview=resolve);}return response;};})()",
  );
  await click("[data-nav=play]");
  await b.until("typeof window.__releasePlayOverview==='function'");
  await click("#navigation [data-nav=home]", { duringPlayWrite: true });
  await b.until("!document.querySelector('#play-root')");
  await b.evaluate("window.__releasePlayOverview()");
  await pause(100);
  assert.equal(
    await b.evaluate("window.__latePlayTimers"),
    0,
    "已离开的控制器不遗留定时器",
  );
  await b.evaluate("window.__restorePlayTimers()");
  await click("[data-nav=play]");
  await b.until("Boolean(document.querySelector('[data-play-open=quiz]'))");
  await b.viewport(1440, 1100);
  await shot("desktop-hub");
  // 明确404的旧本机请求不应永久锁住免费玩法，恢复后仍读取服务端原进度。
  await click("#navigation [data-nav=home]");
  const missingId = "00000000-0000-4000-8000-000000000000",
    pendingKey = "yx.play.pending." + userId;
  await b.evaluate(
    `localStorage.setItem(${JSON.stringify(pendingKey)},JSON.stringify({type:'game',gameId:${JSON.stringify(missingId)},revision:0,uri:'/play/games/${missingId}/action',body:{revision:0,actionId:'expired_local_action',direction:'left'}}))`,
  );
  await click("[data-nav=play]");
  await b.until("Boolean(document.querySelector('[data-play-retry]'))");
  await click("[data-play-retry]");
  await b.until(
    "Boolean(document.querySelector('[data-play-open=merge]:not([disabled])'))",
  );
  assert.equal(
    await b.evaluate(`localStorage.getItem(${JSON.stringify(pendingKey)})`),
    null,
  );
  // 昨日未提交的答题请求明确过期：清理本机请求，不能补答或虚构连续完成。
  await click("#navigation [data-nav=home]");
  const oldOffset = clockOffset;
  clockOffset += 86400000;
  const expiring = store.play.quiz(userId);
  clockOffset += 86400000;
  await b.evaluate(
    `localStorage.setItem(${JSON.stringify(pendingKey)},JSON.stringify({type:'quiz',question:${JSON.stringify(expiring.current)},choice:0,uri:'/play/quiz/${expiring.id}/answer',body:{questionId:${JSON.stringify(expiring.current.id)},choice:0}}))`,
  );
  await click("[data-nav=play]");
  await b.until("Boolean(document.querySelector('[data-play-retry]'))");
  await click("[data-play-retry]");
  await b.until(
    "Boolean(document.querySelector('[data-play-open=quiz]:not([disabled])'))",
  );
  assert.equal(
    await b.evaluate(`localStorage.getItem(${JSON.stringify(pendingKey)})`),
    null,
  );
  assert.equal(
    JSON.parse(
      store.db
        .prepare("SELECT answers_json FROM play_quiz_sessions WHERE id=?")
        .get(expiring.id).answers_json,
    ).length,
    0,
  );
  clockOffset = oldOffset;
  assert.equal(store.profile(userId).balance, 0, "趣玩核心免费且不假发金币");
  assert.equal(store.operations.reconcile().ok, true);
  assert.deepEqual(b.exceptions, []);
  console.log(
    "趣玩浏览器实测通过：大厅、每日5题/解析/完成记录、错题、数字合成键盘触屏/响应丢失及暂停后幂等恢复、翻牌完整通关、离开后迟到创建暂停/初始化无残留定时器、320/390/600px布局、趣玩不发金币与内部账务核对。截图为浏览器，非微信工具或真机。",
  );
} catch (e) {
  if (b) {
    await b.screenshot("/tmp/yx-play-browser-failure.png");
    console.error(
      "趣玩浏览器诊断",
      await b.evaluate(
        "({text:document.querySelector('#play-root')?.textContent?.slice(-1000),toast:document.querySelector('#toast')?.textContent})",
      ),
      b.exceptions,
    );
  }
  throw e;
} finally {
  await b?.close();
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
