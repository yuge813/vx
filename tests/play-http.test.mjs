import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";

async function fixture(t, development = true) {
  const store = new YuanxiangStore({
      development,
      adProvider: development ? "demo" : "disabled",
    }),
    admin = randomBytes(32).toString("hex");
  const { server } = createYuanxiangApp({ store, adminToken: admin });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const request = async (path, method = "GET", data, token = "") => {
    const response = await fetch(
      "http://127.0.0.1:" + server.address().port + path,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  const a = store.login(
    development ? "http_play_user_one" : "wx:http_play_user_one",
    development,
  );
  const b = store.login(
    development ? "http_play_user_two" : "wx:http_play_user_two",
    development,
  );
  return { store, admin, request, a, b };
}

test("趣玩HTTP接入：鉴权、答案与暗牌隔离、越权拒绝、动作幂等及金币不变", async (t) => {
  const { request, a, b, store, admin } = await fixture(t);
  assert.equal((await request("/api/play/quiz")).status, 401);
  assert.equal(
    (await request("/api/admin/play/questions", "GET", undefined, a.token))
      .status,
    401,
  );
  const config = (await request("/api/config")).data;
  assert.equal(config.playEnabled, true);
  assert.equal(config.cashTransfersEnabled, false);
  const quiz = (await request("/api/play/quiz", "GET", undefined, a.token))
    .data;
  assert.equal(quiz.total, 5);
  assert.ok(
    quiz.questions.every(
      (q) => q.correctIndex === undefined && q.explanation === undefined,
    ),
  );
  assert.equal(
    (
      await request(
        `/api/play/quiz/${quiz.id}/answer`,
        "POST",
        { questionId: quiz.current.id, choice: 0 },
        b.token,
      )
    ).status,
    404,
  );
  const answerData = { questionId: quiz.current.id, choice: 0 };
  const answered = await request(
    `/api/play/quiz/${quiz.id}/answer`,
    "POST",
    answerData,
    a.token,
  );
  assert.equal(answered.status, 200);
  assert.equal(answered.data.session.answered, 1);
  assert.equal(typeof answered.data.answer.explanation, "string");
  const repeated = await request(
    `/api/play/quiz/${quiz.id}/answer`,
    "POST",
    answerData,
    a.token,
  );
  assert.equal(repeated.data.session.answered, 1);
  assert.equal(
    (
      await request(
        `/api/play/quiz/${quiz.id}/answer`,
        "POST",
        { ...answerData, choice: 1 },
        a.token,
      )
    ).status,
    409,
  );
  const create = { kind: "memory", requestKey: randomUUID() };
  const game = (await request("/api/play/games", "POST", create, a.token)).data;
  assert.equal(
    (await request("/api/play/games", "POST", create, a.token)).data.id,
    game.id,
  );
  assert.ok(game.state.cards.every((card) => card === null));
  assert.equal(
    (await request(`/api/play/games/${game.id}`, "GET", undefined, b.token))
      .status,
    404,
  );
  const action = { actionId: randomUUID(), revision: game.revision, index: 0 };
  const moved = await request(
    `/api/play/games/${game.id}/action`,
    "POST",
    action,
    a.token,
  );
  assert.equal(moved.status, 200);
  assert.equal(moved.data.revision, game.revision + 1);
  assert.equal(
    moved.data.state.cards.filter((card) => card !== null).length,
    1,
  );
  const duplicate = await request(
    `/api/play/games/${game.id}/action`,
    "POST",
    action,
    a.token,
  );
  assert.deepEqual(duplicate.data, moved.data);
  assert.equal(
    (
      await request(
        `/api/play/games/${game.id}/action`,
        "POST",
        { ...action, index: 1 },
        a.token,
      )
    ).status,
    409,
  );
  const summary = await request(
    "/api/admin/play/summary",
    "GET",
    undefined,
    admin,
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.data.answers, 1);
  assert.equal(store.profile(a.user.id).balance, 0);
  assert.equal(store.operations.reconcile().ok, true);
});

test("生产配置由后端关闭趣玩，直调API也不能开始游戏或取题", async (t) => {
  const { request, a } = await fixture(t, false);
  const overview = await request("/api/play", "GET", undefined, a.token);
  assert.equal(overview.status, 200);
  assert.equal(overview.data.enabled, false);
  assert.equal((await request("/api/config")).data.playEnabled, false);
  assert.equal(
    (await request("/api/play/quiz", "GET", undefined, a.token)).status,
    503,
  );
  assert.equal(
    (
      await request(
        "/api/play/games",
        "POST",
        { kind: "merge", requestKey: randomUUID() },
        a.token,
      )
    ).status,
    503,
  );
});

test("游戏动作独立限流，不放宽金币等普通写接口的限制", async (t) => {
  const { request, a } = await fixture(t);
  const game = (
    await request(
      "/api/play/games",
      "POST",
      { kind: "merge", requestKey: randomUUID() },
      a.token,
    )
  ).data;
  for (let i = 0; i < 121; i++)
    assert.equal(
      (
        await request(
          `/api/play/games/${game.id}/presence`,
          "POST",
          { active: true },
          a.token,
        )
      ).status,
      200,
    );
  assert.equal(
    (await request("/api/profile", "PUT", { name: "限流独立性测试" }, a.token))
      .status,
    200,
  );
  let limited = false;
  for (let i = 0; i < 121; i++) {
    const result = await request("/api/not-a-route", "POST", {}, a.token);
    if (result.status === 429) {
      limited = true;
      break;
    }
    assert.equal(result.status, 404);
  }
  assert.equal(limited, true, "普通写接口仍受120/min限制");
  assert.equal(
    (
      await request(
        `/api/play/games/${game.id}/presence`,
        "POST",
        { active: false },
        a.token,
      )
    ).status,
    200,
  );
});

test("账户导出过滤未答答案和暗牌，注销审核清理非财务趣玩数据并撤销会话", async (t) => {
  const { request, a, admin, store } = await fixture(t);
  await request("/api/play/quiz", "GET", undefined, a.token);
  const game = (
    await request(
      "/api/play/games",
      "POST",
      { kind: "memory", requestKey: randomUUID() },
      a.token,
    )
  ).data;
  await request(
    `/api/play/games/${game.id}/action`,
    "POST",
    { actionId: randomUUID(), revision: 0, index: 0 },
    a.token,
  );
  const exported = (
    await request("/api/account/export", "GET", undefined, a.token)
  ).data;
  assert.ok(exported.play);
  assert.ok(
    exported.play.quiz[0].questions.every((q) => q.correctIndex === undefined),
  );
  assert.equal(
    exported.play.games[0].state.cards.filter((card) => card !== null).length,
    1,
  );
  const closure = await request(
    "/api/account/closure",
    "POST",
    { reason: "停止使用并清理趣玩记录", discardUnclaimed: true },
    a.token,
  );
  assert.equal(closure.status, 200);
  assert.equal(
    (
      await request(
        `/api/admin/closures/${closure.data.id}/review`,
        "POST",
        { action: "approve", reason: "余额为零，按本人申请清理非财务记录" },
        admin,
      )
    ).status,
    200,
  );
  for (const table of [
    "play_games",
    "play_quiz_sessions",
    "play_mistakes",
    "play_game_keys",
  ])
    assert.equal(
      store.db
        .prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`)
        .get(a.user.id).n,
      0,
    );
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) n FROM play_game_actions WHERE game_id=?")
      .get(game.id).n,
    0,
  );
  assert.equal(
    (await request("/api/play/overview", "GET", undefined, a.token)).status,
    401,
  );
});
