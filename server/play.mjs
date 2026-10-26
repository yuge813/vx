import { randomUUID, randomInt, createHash } from "node:crypto";
import { AppError, dayKey } from "./store.mjs";
import engine from "../shared/play-games.cjs";
import { originalQuestions } from "./play-questions.mjs";

const need = (ok, message, status = 400, code = "PLAY_INVALID") => {
  if (!ok) throw new AppError(message, status, code);
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const parse = (value) => JSON.parse(value);
const key = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
const text = (value, min, max, label) => {
  need(
    typeof value === "string" &&
      value.trim().length >= min &&
      Array.from(value.trim()).length <= max,
    `${label}需${min}—${max}字`,
  );
  return value.trim();
};
const notice =
  "趣玩内部原型，免费使用，不发金币或现金；小游戏形态及真实广告场景尚未获准，生产入口关闭。";
const timingNotice =
  "仅累计前台操作和心跳，超过10秒的中断不补计；为个人娱乐记录，不是竞技计时或商业反作弊证明。";

export class Play {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.enabled = store.development;
    this.rng = () => randomInt(0x100000000) / 0x100000000;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS play_questions(id TEXT PRIMARY KEY,draft_json TEXT NOT NULL,published_json TEXT,published_version INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS play_quiz_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,questions_json TEXT NOT NULL,answers_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,day));
      CREATE TABLE IF NOT EXISTS play_mistakes(user_id TEXT NOT NULL REFERENCES users(id),question_id TEXT NOT NULL,question_json TEXT NOT NULL,wrong_count INTEGER NOT NULL,last_wrong_at INTEGER NOT NULL,resolved_at INTEGER,last_reviewed_at INTEGER,PRIMARY KEY(user_id,question_id));
      CREATE TABLE IF NOT EXISTS play_games(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,state_json TEXT NOT NULL,elapsed_ms INTEGER NOT NULL DEFAULT 0,last_seen INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,finished_at INTEGER);
      CREATE INDEX IF NOT EXISTS play_game_user ON play_games(user_id,kind,created_at);
      CREATE TABLE IF NOT EXISTS play_game_keys(user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,game_id TEXT NOT NULL REFERENCES play_games(id) ON DELETE CASCADE,request_json TEXT NOT NULL,PRIMARY KEY(user_id,request_key));
      CREATE TABLE IF NOT EXISTS play_game_actions(game_id TEXT NOT NULL REFERENCES play_games(id) ON DELETE CASCADE,action_id TEXT NOT NULL,payload_hash TEXT NOT NULL,response_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(game_id,action_id));
      CREATE TABLE IF NOT EXISTS play_meta(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    `);
    if (!this.db.prepare("SELECT 1 FROM play_meta WHERE id=1").get()) {
      this.store.transaction(() => {
        const now = this.store.now();
        const insert = this.db.prepare(
          "INSERT INTO play_questions VALUES(?,?,?,1,1,1,?,?)",
        );
        for (const { id, ...q } of originalQuestions) {
          const data = JSON.stringify(this.validateQuestion(q));
          insert.run(id, data, data, now, now);
        }
        this.db.prepare("INSERT INTO play_meta VALUES(1,1)").run();
      });
    }
  }
  ensure(id) {
    need(
      this.enabled,
      "趣玩仍为内部原型，生产准入及广告场景未确认，入口关闭",
      503,
      "PLAY_DISABLED",
    );
    this.store.ensureActive(id);
  }
  validateQuestion(data) {
    need(data && typeof data === "object", "题目数据无效");
    need(
      Array.isArray(data.options) && data.options.length === 4,
      "每题恰好需要4个选项",
    );
    const options = data.options.map((v) => text(v, 1, 60, "选项"));
    need(new Set(options).size === 4, "四个选项不能重复");
    need(
      Number.isInteger(data.correctIndex) &&
        data.correctIndex >= 0 &&
        data.correctIndex < 4,
      "正确答案需为0—3",
    );
    return {
      prompt: text(data.prompt, 4, 180, "题目"),
      options,
      correctIndex: data.correctIndex,
      explanation: text(data.explanation, 4, 400, "解析"),
      category: text(data.category, 1, 20, "分类"),
      sourceNote: text(data.sourceNote, 4, 200, "来源与权利说明"),
    };
  }
  questionView(row) {
    const hasUnpublishedChanges = row.published_json !== row.draft_json;
    return {
      id: row.id,
      ...parse(row.draft_json),
      version: row.version,
      publishedVersion: row.published_version,
      enabled: !!row.enabled,
      state: hasUnpublishedChanges
        ? "draft"
        : row.enabled
          ? "published"
          : "disabled",
      hasUnpublishedChanges,
      published: row.published_json ? parse(row.published_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  questions({ q = "", state = "", category = "" } = {}) {
    need(typeof q === "string" && q.length <= 100, "查询内容过长");
    need(
      ["", "draft", "published", "disabled"].includes(state),
      "题目状态无效",
    );
    const all = this.db
      .prepare("SELECT * FROM play_questions ORDER BY created_at DESC,id")
      .all()
      .map((r) => this.questionView(r));
    const filtered = all.filter(
      (r) =>
        (!q || `${r.prompt} ${r.id} ${r.category}`.includes(q)) &&
        (!state || r.state === state) &&
        (!category || r.category === category),
    );
    return {
      items: filtered.slice(0, 200),
      total: filtered.length,
      categories: [...new Set(all.map((r) => r.category))],
      notice:
        "保存草稿不会替换已发布内容；新会话只使用启用的已发布快照，已有会话不受编辑或停用影响。",
    };
  }
  questionRow(id) {
    const row = this.db
      .prepare("SELECT * FROM play_questions WHERE id=?")
      .get(id);
    need(row, "题目不存在", 404);
    return row;
  }
  checkVersion(row, version) {
    need(
      version === row.version,
      "题目已被修改，请刷新后重试",
      409,
      "PLAY_VERSION_CONFLICT",
    );
  }
  createQuestion(data) {
    const q = this.validateQuestion(data);
    return this.store.transaction(() => {
      need(
        this.db.prepare("SELECT COUNT(*) n FROM play_questions").get().n < 1000,
        "题库达到1000题内部上限",
      );
      const id = randomUUID(),
        now = this.store.now();
      this.db
        .prepare("INSERT INTO play_questions VALUES(?,?,NULL,0,1,0,?,?)")
        .run(id, JSON.stringify(q), now, now);
      this.store.audit("play.question.create", id, {
        version: 1,
        sourceNote: q.sourceNote,
      });
      return this.questionView(this.questionRow(id));
    });
  }
  editQuestion(id, data) {
    const q = this.validateQuestion(data);
    return this.store.transaction(() => {
      const row = this.questionRow(id);
      this.checkVersion(row, data.version);
      this.db
        .prepare(
          "UPDATE play_questions SET draft_json=?,version=version+1,updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(q), this.store.now(), id);
      this.store.audit("play.question.edit", id, { fromVersion: row.version });
      return this.questionView(this.questionRow(id));
    });
  }
  publishQuestion(id, data) {
    need(
      data?.rightsConfirmed === true && data?.answerChecked === true,
      "发布前须确认原创/授权与答案解析已核对",
    );
    const reviewNote = text(data.reviewNote, 2, 200, "审核说明");
    return this.store.transaction(() => {
      const row = this.questionRow(id);
      this.checkVersion(row, data.version);
      this.db
        .prepare(
          "UPDATE play_questions SET published_json=draft_json,published_version=version+1,version=version+1,enabled=1,updated_at=? WHERE id=?",
        )
        .run(this.store.now(), id);
      this.store.audit("play.question.publish", id, {
        version: row.version + 1,
        rightsConfirmed: true,
        answerChecked: true,
        reviewNote,
      });
      return this.questionView(this.questionRow(id));
    });
  }
  disableQuestion(id, data) {
    return this.store.transaction(() => {
      const row = this.questionRow(id);
      this.checkVersion(row, data?.version);
      this.db
        .prepare(
          "UPDATE play_questions SET enabled=0,version=version+1,updated_at=? WHERE id=?",
        )
        .run(this.store.now(), id);
      this.store.audit("play.question.disable", id, {
        fromVersion: row.version,
      });
      return this.questionView(this.questionRow(id));
    });
  }
  quizRow(id, userId) {
    const row = this.db
      .prepare("SELECT * FROM play_quiz_sessions WHERE id=? AND user_id=?")
      .get(id, userId);
    need(row, "今日趣答不存在", 404);
    return row;
  }
  publicQuestion(q, index) {
    return {
      id: q.id,
      index,
      prompt: q.prompt,
      options: q.options,
      category: q.category,
    };
  }
  quizView(row) {
    const questions = parse(row.questions_json),
      answers = parse(row.answers_json);
    const results = answers.map((a, index) => ({
      ...this.publicQuestion(questions[index], index),
      questionId: questions[index].id,
      ...a,
      correctIndex: questions[index].correctIndex,
      explanation: questions[index].explanation,
    }));
    return {
      id: row.id,
      sessionId: row.id,
      day: row.day,
      total: questions.length,
      answered: answers.length,
      correct: answers.filter((a) => a.correct).length,
      completed: answers.length === questions.length,
      current:
        answers.length < questions.length
          ? this.publicQuestion(questions[answers.length], answers.length)
          : null,
      questions: questions.map((q, i) => ({
        ...this.publicQuestion(q, i),
        ...(results[i] ? { answer: results[i] } : {}),
      })),
      results,
      serverTime: this.store.now(),
    };
  }
  quiz(id) {
    this.ensure(id);
    return this.store.transaction(() => {
      const day = dayKey(this.store.now());
      let row = this.db
        .prepare("SELECT * FROM play_quiz_sessions WHERE user_id=? AND day=?")
        .get(id, day);
      if (!row) {
        const source = this.db
          .prepare(
            "SELECT * FROM play_questions WHERE enabled=1 AND published_json IS NOT NULL",
          )
          .all();
        need(
          source.length >= 5,
          "已发布题目不足5题，请联系运营补充",
          503,
          "PLAY_CONTENT_UNAVAILABLE",
        );
        const selected = source
          .sort((a, b) => digest(day + a.id).localeCompare(digest(day + b.id)))
          .slice(0, 5)
          .map((r) => {
            const q = parse(r.published_json),
              shift =
                parseInt(digest(day + r.id + ":options").slice(0, 2), 16) % 4;
            return {
              id: r.id,
              ...q,
              options: q.options.map((_, i) => q.options[(i + shift) % 4]),
              correctIndex: (q.correctIndex - shift + 4) % 4,
              version: r.published_version,
            };
          });
        const now = this.store.now(),
          session = randomUUID();
        this.db
          .prepare("INSERT INTO play_quiz_sessions VALUES(?,?,?,?,?,?,?)")
          .run(session, id, day, JSON.stringify(selected), "[]", now, now);
        row = this.quizRow(session, id);
      }
      return this.quizView(row);
    });
  }
  answer(id, sessionId, data) {
    this.ensure(id);
    need(
      Number.isInteger(data?.choice) && data.choice >= 0 && data.choice < 4,
      "请选择一个有效选项",
    );
    return this.store.transaction(() => {
      const row = this.quizRow(sessionId, id),
        questions = parse(row.questions_json),
        answers = parse(row.answers_json),
        index = questions.findIndex((q) => q.id === data.questionId);
      need(index >= 0, "题目不属于此轮趣答", 404);
      if (answers[index]) {
        need(
          answers[index].choice === data.choice,
          "该题已经提交了其他答案",
          409,
          "PLAY_ANSWER_CONFLICT",
        );
        const session = this.quizView(row);
        return {
          answer: session.results[index],
          session,
          alreadyAnswered: true,
        };
      }
      need(
        row.day === dayKey(this.store.now()),
        "题单日期已更新，请返回大厅重新打开今日趣答",
        409,
        "PLAY_QUIZ_EXPIRED",
      );
      need(index === answers.length, "请按顺序完成当前题目", 409);
      const q = questions[index],
        answer = {
          choice: data.choice,
          correct: data.choice === q.correctIndex,
          answeredAt: this.store.now(),
        };
      answers.push(answer);
      this.db
        .prepare(
          "UPDATE play_quiz_sessions SET answers_json=?,updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(answers), this.store.now(), row.id);
      if (!answer.correct)
        this.db
          .prepare(
            "INSERT INTO play_mistakes VALUES(?,?,?,?,?,NULL,NULL) ON CONFLICT(user_id,question_id) DO UPDATE SET question_json=excluded.question_json,wrong_count=wrong_count+1,last_wrong_at=excluded.last_wrong_at,resolved_at=NULL",
          )
          .run(id, q.id, JSON.stringify(q), 1, this.store.now());
      const session = this.quizView(this.quizRow(row.id, id));
      return {
        answer: session.results[index],
        session,
        alreadyAnswered: false,
      };
    });
  }
  mistakes(id) {
    this.ensure(id);
    const rows = this.db
      .prepare(
        "SELECT * FROM play_mistakes WHERE user_id=? AND resolved_at IS NULL ORDER BY last_wrong_at DESC LIMIT 100",
      )
      .all(id);
    return {
      items: rows.map((r) => {
        const q = this.publicQuestion(parse(r.question_json));
        return {
          ...q,
          questionId: q.id,
          question: q,
          wrongCount: r.wrong_count,
          lastWrongAt: r.last_wrong_at,
        };
      }),
    };
  }
  reviewMistake(id, questionId, data) {
    this.ensure(id);
    need(
      Number.isInteger(data?.choice) && data.choice >= 0 && data.choice < 4,
      "请选择一个有效选项",
    );
    return this.store.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT * FROM play_mistakes WHERE user_id=? AND question_id=?",
        )
        .get(id, questionId);
      need(row, "错题不存在", 404);
      const q = parse(row.question_json),
        correct = data.choice === q.correctIndex,
        now = this.store.now();
      this.db
        .prepare(
          "UPDATE play_mistakes SET resolved_at=?,last_reviewed_at=? WHERE user_id=? AND question_id=?",
        )
        .run(correct ? now : null, now, id, questionId);
      return {
        ...this.publicQuestion(q),
        questionId,
        choice: data.choice,
        correct,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        resolved: correct,
      };
    });
  }
  gameRow(userId, id) {
    const row = this.db
      .prepare("SELECT * FROM play_games WHERE id=? AND user_id=?")
      .get(id, userId);
    need(row, "游戏记录不存在", 404);
    return row;
  }
  gameView(row) {
    const state = parse(row.state_json);
    return {
      id: row.id,
      kind: row.kind,
      revision: row.revision,
      status: row.status,
      state: row.kind === "memory" ? engine.publicMemory(state) : state,
      score: state.score,
      elapsedMs: row.elapsed_ms,
      paused: row.last_seen === null || row.status !== "active",
      serverTime: this.store.now(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      timingNotice,
    };
  }
  game(userId, id) {
    this.ensure(userId);
    return this.gameView(this.gameRow(userId, id));
  }
  clock(row, active) {
    const now = this.store.now(),
      delta = row.last_seen === null ? 0 : now - row.last_seen;
    return {
      elapsed: row.elapsed_ms + (delta >= 0 && delta <= 10000 ? delta : 0),
      lastSeen: active && row.status === "active" ? now : null,
    };
  }
  startGame(userId, data) {
    this.ensure(userId);
    need(["merge", "memory"].includes(data?.kind), "游戏类型无效");
    need(key(data.requestKey), "请提供8—100位唯一请求编号");
    need(
      data.restart === undefined || typeof data.restart === "boolean",
      "重新开始标记无效",
    );
    return this.store.transaction(() => {
      const request = JSON.stringify({
        kind: data.kind,
        restart: !!data.restart,
      });
      const old = this.db
        .prepare(
          "SELECT * FROM play_game_keys WHERE user_id=? AND request_key=?",
        )
        .get(userId, data.requestKey);
      if (old) {
        need(
          old.request_json === request,
          "请求编号已用于其他游戏请求",
          409,
          "PLAY_REQUEST_CONFLICT",
        );
        return this.gameView(this.gameRow(userId, old.game_id));
      }
      const active = this.db
        .prepare(
          "SELECT * FROM play_games WHERE user_id=? AND kind=? AND status='active' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        )
        .get(userId, data.kind);
      let gameId;
      if (active && !data.restart) gameId = active.id;
      else {
        if (active) {
          const clock = this.clock(active, false);
          this.db
            .prepare(
              "UPDATE play_games SET status='finished',revision=revision+1,elapsed_ms=?,last_seen=NULL,updated_at=?,finished_at=? WHERE id=?",
            )
            .run(clock.elapsed, this.store.now(), this.store.now(), active.id);
        }
        const count = this.db
          .prepare(
            "SELECT COUNT(*) n FROM play_games WHERE user_id=? AND created_at>=?",
          )
          .get(userId, this.store.startOfDay()).n;
        need(
          count < 100,
          "今日新开游戏已达100局内部上限",
          429,
          "PLAY_DAILY_LIMIT",
        );
        gameId = randomUUID();
        const now = this.store.now(),
          state =
            data.kind === "merge"
              ? engine.createMerge(this.rng)
              : engine.createMemory(this.rng, 8);
        this.db
          .prepare(
            "INSERT INTO play_games VALUES(?,?,?,0,'active',?,0,?,?,?,NULL)",
          )
          .run(gameId, userId, data.kind, JSON.stringify(state), now, now, now);
        this.store.audit("play.game.start", gameId, { kind: data.kind });
      }
      this.db
        .prepare("INSERT INTO play_game_keys VALUES(?,?,?,?)")
        .run(userId, data.requestKey, gameId, request);
      return this.gameView(this.gameRow(userId, gameId));
    });
  }
  applyAction(userId, id, data, type, change) {
    this.ensure(userId);
    need(key(data?.actionId), "请提供8—100位唯一动作编号");
    need(
      Number.isSafeInteger(data.revision) && data.revision >= 0,
      "游戏版本无效",
    );
    return this.store.transaction(() => {
      const row = this.gameRow(userId, id);
      const payload = {
        type,
        revision: data.revision,
        ...(type === "move"
          ? row.kind === "merge"
            ? { direction: data.direction }
            : { index: data.index }
          : {}),
      };
      const hash = digest(JSON.stringify(payload));
      const old = this.db
        .prepare(
          "SELECT * FROM play_game_actions WHERE game_id=? AND action_id=?",
        )
        .get(id, data.actionId);
      if (old) {
        need(
          old.payload_hash === hash,
          "动作编号已用于其他操作",
          409,
          "PLAY_ACTION_CONFLICT",
        );
        return parse(old.response_json);
      }
      need(
        row.revision === data.revision,
        "游戏进度已更新，请恢复原游戏后继续",
        409,
        "PLAY_VERSION_CONFLICT",
      );
      need(row.status === "active", "游戏已经结束，请开始新一局", 409);
      need(
        type !== "move" || row.last_seen !== null,
        "游戏已暂停，请恢复后继续",
        409,
        "PLAY_PAUSED",
      );
      const state = change(parse(row.state_json), row);
      const finished = type === "finish" || state.over,
        now = this.store.now(),
        clock = this.clock(row, !finished);
      this.db
        .prepare(
          "UPDATE play_games SET revision=revision+1,status=?,state_json=?,elapsed_ms=?,last_seen=?,updated_at=?,finished_at=? WHERE id=?",
        )
        .run(
          finished ? "finished" : "active",
          JSON.stringify(state),
          clock.elapsed,
          clock.lastSeen,
          now,
          finished ? now : null,
          id,
        );
      const result = this.gameView(this.gameRow(userId, id));
      this.db
        .prepare("INSERT INTO play_game_actions VALUES(?,?,?,?,?)")
        .run(id, data.actionId, hash, JSON.stringify(result), now);
      if (finished)
        this.store.audit("play.game.finish", id, {
          kind: row.kind,
          score: state.score,
          reason: type === "finish" ? "user_finish" : "rules_complete",
        });
      return result;
    });
  }
  act(userId, id, data) {
    return this.applyAction(userId, id, data, "move", (state, row) => {
      if (row.kind === "merge") {
        need(engine.directions.includes(data.direction), "移动方向无效");
        return engine.moveMerge(state, data.direction, this.rng);
      }
      need(
        Number.isInteger(data.index) &&
          data.index >= 0 &&
          data.index < state.cards.length,
        "翻牌位置无效",
      );
      return engine.flipMemory(state, data.index);
    });
  }
  finish(userId, id, data) {
    return this.applyAction(userId, id, data, "finish", (state) => state);
  }
  presence(userId, id, active) {
    this.ensure(userId);
    need(typeof active === "boolean", "前台状态无效");
    return this.store.transaction(() => {
      const row = this.gameRow(userId, id),
        clock = this.clock(row, active);
      this.db
        .prepare(
          "UPDATE play_games SET elapsed_ms=?,last_seen=?,updated_at=? WHERE id=?",
        )
        .run(clock.elapsed, clock.lastSeen, this.store.now(), id);
      return this.gameView(this.gameRow(userId, id));
    });
  }
  dailySummary(id) {
    const day = dayKey(this.store.now()),
      row = this.db
        .prepare("SELECT * FROM play_quiz_sessions WHERE user_id=? AND day=?")
        .get(id, day);
    const current = row
      ? this.quizView(row)
      : { id: null, total: 5, answered: 0, correct: 0, completed: false };
    const completed = new Set(
      this.db
        .prepare(
          "SELECT day FROM play_quiz_sessions WHERE user_id=? AND json_array_length(answers_json)=json_array_length(questions_json)",
        )
        .all(id)
        .map((r) => r.day),
    );
    let streak = 0;
    for (let ago = current.completed ? 0 : 1; ago < 367; ago++) {
      if (!completed.has(dayKey(this.store.now() - ago * 86400000))) break;
      streak++;
    }
    return {
      sessionId: current.id,
      day,
      total: current.total,
      answered: current.answered,
      correct: current.correct,
      completed: current.completed,
      streak,
    };
  }
  overview(id) {
    this.store.user(id);
    if (!this.enabled)
      return {
        enabled: false,
        day: dayKey(this.store.now()),
        quiz: null,
        daily: null,
        games: [],
        activeGames: [],
        stats: { bestMerge: 0, best2048: 0, bestMemory: 0 },
        notice,
      };
    const games = ["merge", "memory"].map((kind) => {
      const rows = this.db
        .prepare(
          "SELECT * FROM play_games WHERE user_id=? AND kind=? ORDER BY created_at DESC,rowid DESC",
        )
        .all(id, kind);
      return {
        kind,
        title: kind === "merge" ? "数字合成" : "记忆翻牌",
        bestScore: rows.reduce(
          (best, r) => Math.max(best, parse(r.state_json).score),
          0,
        ),
        lastSession: rows[0] ? this.gameView(rows[0]) : null,
      };
    });
    const quiz = this.dailySummary(id);
    return {
      enabled: true,
      day: dayKey(this.store.now()),
      quiz,
      daily: quiz,
      games,
      activeGames: games
        .map((g) => g.lastSession)
        .filter((g) => g?.status === "active"),
      stats: {
        bestMerge: games[0].bestScore,
        best2048: games[0].bestScore,
        bestMemory: games[1].bestScore,
      },
      notice,
    };
  }
  summary() {
    const qs = this.db
        .prepare(
          "SELECT COUNT(*) questionCount,COALESCE(SUM(enabled=1 AND published_json IS NOT NULL),0) publishedCount,COALESCE(SUM(published_json IS NOT draft_json),0) draftCount FROM play_questions",
        )
        .get(),
      quiz = this.db
        .prepare(
          "SELECT COUNT(*) total,COALESCE(SUM(json_array_length(answers_json)),0) answers,COALESCE(SUM(json_array_length(answers_json)=json_array_length(questions_json)),0) completed FROM play_quiz_sessions",
        )
        .get();
    const games = this.db
      .prepare(
        "SELECT COUNT(*) total,COALESCE(SUM(status='finished'),0) completed,COALESCE(SUM(json_extract(state_json,'$.won')=1),0) won FROM play_games",
      )
      .get();
    return {
      enabled: this.enabled,
      ...qs,
      quizSessions: quiz.total,
      quizCompleted: quiz.completed,
      answers: quiz.answers,
      gameSessions: games.total,
      gameCompleted: games.completed,
      gameWon: games.won,
      notice:
        "真实业务记录；已结束局数包含主动结束与重开，不等于通关。不是在线人数、广告曝光或收入；游戏分不兑换金币。",
    };
  }
  exportData(id) {
    return {
      quiz: this.db
        .prepare(
          "SELECT * FROM play_quiz_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(id)
        .map((r) => this.quizView(r)),
      games: this.db
        .prepare(
          "SELECT * FROM play_games WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(id)
        .map((r) => this.gameView(r)),
      mistakes: this.db
        .prepare(
          "SELECT * FROM play_mistakes WHERE user_id=? ORDER BY last_wrong_at DESC LIMIT 100",
        )
        .all(id)
        .map((r) => ({
          question: this.publicQuestion(parse(r.question_json)),
          wrongCount: r.wrong_count,
          lastWrongAt: r.last_wrong_at,
          lastReviewedAt: r.last_reviewed_at,
          resolved: r.resolved_at !== null,
          resolvedAt: r.resolved_at,
        })),
    };
  }
  erasePersonal(id) {
    this.db.prepare("DELETE FROM play_game_keys WHERE user_id=?").run(id);
    this.db.prepare("DELETE FROM play_games WHERE user_id=?").run(id);
    this.db.prepare("DELETE FROM play_quiz_sessions WHERE user_id=?").run(id);
    this.db.prepare("DELETE FROM play_mistakes WHERE user_id=?").run(id);
  }
}
