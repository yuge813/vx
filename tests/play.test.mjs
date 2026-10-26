import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { originalQuestions } from "../server/play-questions.mjs";

function fixture(t, options = {}) {
  let now = Date.parse("2026-10-25T03:00:00Z");
  const store = new YuanxiangStore({ now: () => now, ...options });
  store.play.rng = () => 0;
  t.after(() => store.close());
  const user = store.login("play_test_installation").user.id;
  return {
    store,
    p: store.play,
    user,
    advance: (ms) => {
      now += ms;
    },
  };
}
const privateQuiz = (s, id) =>
  JSON.parse(
    s.db
      .prepare("SELECT questions_json FROM play_quiz_sessions WHERE id=?")
      .get(id).questions_json,
  );
const privateGame = (s, id) =>
  JSON.parse(
    s.db.prepare("SELECT state_json FROM play_games WHERE id=?").get(id)
      .state_json,
  );
function doneQuiz(s, u) {
  let q = s.play.quiz(u);
  while (q.current)
    q = s.play.answer(u, q.id, {
      questionId: q.current.id,
      choice: privateQuiz(s, q.id)[q.answered].correctIndex,
    }).session;
  return q;
}
test("原创题库60题格式与答案合法，每日5题可恢复，未答答案和解析不泄漏", (t) => {
  const { store: s, p, user: u } = fixture(t);
  assert.equal(originalQuestions.length, 60);
  assert.equal(p.summary().publishedCount, 60);
  const q = p.quiz(u);
  assert.equal(q.total, 5);
  assert.equal(q.answered, 0);
  assert.equal(q.questions.length, 5);
  assert.equal(/correctIndex|explanation/.test(JSON.stringify(q)), false);
  assert.equal(p.quiz(u).id, q.id);
  assert.equal(p.overview(u).daily.sessionId, q.id);
  assert.equal(s.profile(u).balance, 0);
  for (const item of originalQuestions) {
    assert.equal(new Set(item.options).size, 4);
    assert.ok(item.options[item.correctIndex]);
  }
});
test("跨日不能补答旧题单伪造连续完成，已提交答案跨日恢复仍幂等", (t) => {
  const { store, p, user, advance } = fixture(t);
  const old = p.quiz(user),
    first = { questionId: old.current.id, choice: 0 };
  p.answer(user, old.id, first);
  advance(86400000);
  assert.equal(p.answer(user, old.id, first).alreadyAnswered, true);
  assert.throws(
    () =>
      p.answer(user, old.id, { questionId: old.questions[1].id, choice: 0 }),
    (e) => e.status === 409 && e.code === "PLAY_QUIZ_EXPIRED",
  );
  doneQuiz(store, user);
  assert.equal(p.overview(user).quiz.streak, 1);
  assert.equal(p.quizView(p.quizRow(old.id, user)).completed, false);
});
test("每日判题按顺序和账户隔离，重复相同答案幂等，冲突答案被拒绝", (t) => {
  const { store: s, p, user: u } = fixture(t),
    other = s.login("other_play_installation").user.id;
  const q = p.quiz(u),
    secret = privateQuiz(s, q.id),
    choice = (secret[0].correctIndex + 1) % 4;
  assert.throws(
    () => p.answer(other, q.id, { questionId: q.current.id, choice }),
    (e) => e.status === 404,
  );
  assert.throws(
    () => p.answer(u, q.id, { questionId: q.questions[2].id, choice }),
    (e) => e.status === 409,
  );
  const answer = p.answer(u, q.id, { questionId: q.current.id, choice });
  assert.equal(answer.answer.correct, false);
  assert.equal(answer.answer.correctIndex, secret[0].correctIndex);
  assert.equal(answer.session.answered, 1);
  assert.ok(answer.answer.explanation);
  assert.equal(
    p.answer(u, q.id, { questionId: q.current.id, choice }).alreadyAnswered,
    true,
  );
  assert.throws(
    () =>
      p.answer(u, q.id, {
        questionId: q.current.id,
        choice: secret[0].correctIndex,
      }),
    (e) => e.status === 409,
  );
  assert.equal(p.quiz(u).answered, 1);
  assert.equal(p.mistakes(u).items.length, 1);
  assert.equal(
    /correctIndex|explanation/.test(JSON.stringify(p.mistakes(u))),
    false,
  );
  assert.equal(
    p.reviewMistake(u, q.current.id, { choice: secret[0].correctIndex })
      .resolved,
    true,
  );
  assert.equal(p.mistakes(u).items.length, 0);
  assert.equal(s.profile(u).balance, 0);
  assert.equal(s.operations.reconcile().ok, true);
});
test("完成每日题保存真实正确数、北京时间跨日和连续记录，不发金币", (t) => {
  const { store: s, p, user: u, advance } = fixture(t);
  const first = doneQuiz(s, u);
  assert.equal(first.correct, 5);
  assert.equal(first.completed, true);
  assert.equal(p.overview(u).daily.streak, 1);
  advance(86400000);
  assert.equal(p.overview(u).daily.answered, 0);
  assert.equal(p.overview(u).daily.streak, 1);
  const second = doneQuiz(s, u);
  assert.notEqual(second.id, first.id);
  assert.equal(p.overview(u).daily.streak, 2);
  advance(2 * 86400000);
  assert.equal(p.overview(u).daily.streak, 0);
  assert.equal(s.profile(u).balance, 0);
});
test("题库草稿与发布分离、发布双确认、版本冲突，已有会话保留答案快照", (t) => {
  const { store: s, p, user: u } = fixture(t),
    q = p.quiz(u),
    old = privateQuiz(s, q.id)[0];
  const row = p.questions({ q: old.id }).items[0];
  const draft = p.editQuestion(old.id, {
    ...row,
    prompt: "新版题目应该如何回答？",
    correctIndex: (row.correctIndex + 1) % 4,
    version: row.version,
  });
  assert.equal(draft.state, "draft");
  assert.equal(draft.enabled, true);
  assert.equal(draft.published.prompt, row.prompt);
  assert.throws(
    () =>
      p.publishQuestion(old.id, {
        version: draft.version,
        reviewNote: "人工校对",
      }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => p.editQuestion(old.id, { ...draft, version: row.version }),
    (e) => e.status === 409,
  );
  const live = p.publishQuestion(old.id, {
    version: draft.version,
    reviewNote: "原创与答案复核",
    rightsConfirmed: true,
    answerChecked: true,
  });
  assert.equal(live.state, "published");
  assert.equal(live.published.prompt, draft.prompt);
  p.disableQuestion(old.id, { version: live.version });
  const answered = p.answer(u, q.id, {
    questionId: old.id,
    choice: old.correctIndex,
  });
  assert.equal(answered.answer.correct, true);
  assert.equal(answered.answer.prompt, old.prompt);
  const other = s.login("new_play_after_publish").user.id;
  assert.equal(
    p.quiz(other).questions.some((item) => item.id === old.id),
    false,
  );
  assert.ok(
    s.db
      .prepare("SELECT 1 FROM audit WHERE action='play.question.publish'")
      .get(),
  );
});
test("自定义题目校验、少于5道已发布题时不创建半成品会话", (t) => {
  const { p, store: s, user: u } = fixture(t);
  assert.throws(() =>
    p.createQuestion({
      ...originalQuestions[0],
      options: ["同", "同", "异", "别"],
    }),
  );
  const q = p.createQuestion({
    ...originalQuestions[0],
    prompt: "这是一个原创示例题目？",
  });
  assert.equal(q.enabled, false);
  assert.equal(q.published, null);
  assert.equal(q.state, "draft");
  s.db.prepare("UPDATE play_questions SET enabled=0").run();
  assert.throws(
    () => p.quiz(u),
    (e) => e.code === "PLAY_CONTENT_UNAVAILABLE",
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(*) n FROM play_quiz_sessions").get().n,
    0,
  );
});
test("题库超过200题时概览统计全库而非列表窗口", (t) => {
  const { p, store: s } = fixture(t),
    sample = JSON.stringify(p.validateQuestion(originalQuestions[0]));
  const insert = s.db.prepare(
    "INSERT INTO play_questions VALUES(?,?,NULL,0,1,0,0,0)",
  );
  for (let i = 0; i < 150; i++) insert.run("bulk_question_" + i, sample);
  assert.equal(p.questions().items.length, 200);
  assert.equal(p.questions().total, 210);
  assert.equal(p.summary().questionCount, 210);
  assert.equal(p.summary().draftCount, 150);
  assert.equal(p.summary().publishedCount, 60);
});
test("游戏开始请求幂等、恢复活跃局、显式重开只结束原局，不能跨账户读档", (t) => {
  const { p, store: s, user: u } = fixture(t);
  const data = { kind: "merge", requestKey: "create_request_001" },
    game = p.startGame(u, data);
  assert.equal(p.startGame(u, data).id, game.id);
  assert.equal(
    p.startGame(u, { ...data, requestKey: "new_alias_request" }).id,
    game.id,
  );
  const next = p.startGame(u, {
    kind: "merge",
    requestKey: "restart_request_001",
    restart: true,
  });
  assert.notEqual(next.id, game.id);
  assert.equal(p.game(u, game.id).status, "finished");
  assert.equal(
    p.startGame(u, data).id,
    game.id,
    "原请求重放恢复原局，不新建第三局",
  );
  assert.throws(
    () => p.startGame(u, { ...data, kind: "memory" }),
    (e) => e.status === 409,
  );
  const other = s.login("another_game_account").user.id;
  assert.throws(
    () => p.game(other, next.id),
    (e) => e.status === 404,
  );
});
test("2048服务器执行动作与随机出块，同actionId重试不再执行，旧版本409", (t) => {
  const { p, user: u } = fixture(t),
    game = p.startGame(u, { kind: "merge", requestKey: "merge_game_request" });
  const move = {
    revision: game.revision,
    actionId: "merge_action_001",
    direction: "left",
    score: 999999999,
    board: Array(16).fill(2048),
  };
  const result = p.act(u, game.id, move);
  assert.equal(result.revision, 1);
  assert.equal(result.score, 4);
  assert.equal(result.state.moves, 1);
  assert.deepEqual(p.act(u, game.id, move), result);
  assert.throws(
    () => p.act(u, game.id, { ...move, direction: "right" }),
    (e) => e.code === "PLAY_ACTION_CONFLICT",
  );
  assert.throws(
    () => p.act(u, game.id, { ...move, actionId: "merge_action_002" }),
    (e) => e.code === "PLAY_VERSION_CONFLICT",
  );
  assert.equal(p.game(u, game.id).state.moves, 1);
  assert.equal(
    p.finish(u, game.id, {
      revision: 1,
      actionId: "merge_finish_001",
      score: 999999,
    }).score,
    4,
  );
  assert.equal(p.overview(u).stats.best2048, 4);
});
test("翻牌暗牌不公开，命中配对由服务器判定，重复动作与全局完成安全", (t) => {
  const { p, user: u, store: s } = fixture(t);
  let game = p.startGame(u, {
    kind: "memory",
    requestKey: "memory_game_request",
  });
  assert.equal(game.state.cards.length, 16);
  assert.ok(game.state.cards.every((v) => v === null));
  const cards = privateGame(s, game.id).cards,
    pairs = new Map();
  cards.forEach((value, index) =>
    pairs.set(value, [...(pairs.get(value) || []), index]),
  );
  let n = 0;
  for (const indexes of pairs.values())
    for (const index of indexes) {
      const action = {
        revision: game.revision,
        actionId: "memory_action_" + String(++n).padStart(3, "0"),
        index,
      };
      game = p.act(u, game.id, action);
      assert.equal(game.state.cards[index], cards[index]);
      assert.deepEqual(p.act(u, game.id, action), game);
    }
  assert.equal(game.status, "finished");
  assert.equal(game.state.won, true);
  assert.equal(game.score, 800);
  assert.equal(game.state.matched.length, 16);
  assert.equal(s.profile(u).balance, 0);
  assert.equal(s.operations.reconcile().ok, true);
});
test("前台心跳累计时长，暂停与离线长间隔不补计，presence不改动作版本", (t) => {
  const { p, user: u, advance } = fixture(t);
  let game = p.startGame(u, {
    kind: "memory",
    requestKey: "memory_time_request",
  });
  advance(5000);
  game = p.presence(u, game.id, true);
  assert.equal(game.elapsedMs, 5000);
  assert.equal(game.revision, 0);
  advance(3000);
  game = p.presence(u, game.id, false);
  assert.equal(game.elapsedMs, 8000);
  assert.equal(game.paused, true);
  assert.throws(
    () =>
      p.act(u, game.id, {
        revision: 0,
        actionId: "paused_new_action",
        index: 0,
      }),
    (e) => e.code === "PLAY_PAUSED",
  );
  assert.equal(p.game(u, game.id).revision, 0);
  advance(600000);
  game = p.presence(u, game.id, true);
  assert.equal(game.elapsedMs, 8000);
  advance(20000);
  game = p.presence(u, game.id, true);
  assert.equal(game.elapsedMs, 8000, "没有正常心跳的长间隔不补算");
  advance(5000);
  game = p.act(u, game.id, {
    revision: 0,
    actionId: "timed_flip_action",
    index: 0,
  });
  assert.equal(game.elapsedMs, 13000);
  p.presence(u, game.id, false);
  const duplicate = p.act(u, game.id, {
    revision: 0,
    actionId: "timed_flip_action",
    index: 0,
  });
  assert.equal(duplicate.revision, 1);
  assert.equal(
    p.game(u, game.id).paused,
    true,
    "已提交动作重放不恢复当前暂停状态",
  );
  const finished = p.finish(u, game.id, {
    revision: 1,
    actionId: "paused_finish_action",
  });
  assert.equal(finished.status, "finished");
  assert.equal(finished.paused, true);
  assert.equal(finished.elapsedMs, 13000);
});
test("导出不包含暗牌或未答答案，注销清理不涉及金币账本", (t) => {
  const { p, user: u, store: s } = fixture(t);
  p.quiz(u);
  const game = p.startGame(u, {
    kind: "memory",
    requestKey: "export_memory_game",
  });
  p.act(u, game.id, { revision: 0, actionId: "export_one_action", index: 0 });
  const exported = p.exportData(u);
  assert.equal(
    exported.games[0].state.cards.filter((v) => v !== null).length,
    1,
  );
  assert.equal(
    /correctIndex|explanation/.test(JSON.stringify(exported.quiz)),
    false,
  );
  s.transaction(() => p.erasePersonal(u));
  for (const table of [
    "play_games",
    "play_game_actions",
    "play_game_keys",
    "play_quiz_sessions",
    "play_mistakes",
  ])
    assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.equal(s.profile(u).balance, 0);
  assert.equal(s.operations.reconcile().ok, true);
});
test("数据库重启后保留每日进度、游戏状态及已提交动作幂等", (t) => {
  const root = mkdtempSync(join(tmpdir(), "play-db-")),
    path = join(root, "review.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let s = new YuanxiangStore({ path }),
    u = s.login("persistent_play_account").user.id;
  s.play.rng = () => 0;
  const quiz = s.play.quiz(u),
    question = privateQuiz(s, quiz.id)[0];
  s.play.answer(u, quiz.id, {
    questionId: question.id,
    choice: question.correctIndex,
  });
  const game = s.play.startGame(u, {
      kind: "merge",
      requestKey: "persistent_game_key",
    }),
    action = {
      revision: 0,
      actionId: "persistent_action_key",
      direction: "left",
    };
  const result = s.play.act(u, game.id, action);
  s.close();
  s = new YuanxiangStore({ path });
  try {
    assert.equal(s.play.quiz(u).answered, 1);
    assert.equal(s.play.game(u, game.id).score, result.score);
    assert.deepEqual(s.play.act(u, game.id, action), result);
  } finally {
    s.close();
  }
});
test("生产返回关闭状态并拒绝趣答、游戏和错题业务操作", () => {
  const s = new YuanxiangStore({ development: false, adProvider: "disabled" });
  try {
    const u = s.login("wx:production_play_account", false).user.id,
      p = s.play;
    assert.equal(p.overview(u).enabled, false);
    for (const fn of [
      () => p.quiz(u),
      () => p.mistakes(u),
      () => p.reviewMistake(u, "x", { choice: 0 }),
      () => p.startGame(u, { kind: "merge", requestKey: "production_key" }),
      () => p.game(u, "x"),
      () => p.act(u, "x", {}),
      () => p.finish(u, "x", {}),
      () => p.presence(u, "x", true),
    ])
      assert.throws(fn, (e) => e.status === 503 && e.code === "PLAY_DISABLED");
    assert.equal(
      s.db.prepare("SELECT COUNT(*) n FROM play_quiz_sessions").get().n,
      0,
    );
  } finally {
    s.close();
  }
});
