import { esc } from "./shared.js";

const shapes = [
  "circle",
  "diamond",
  "triangle",
  "square",
  "cross",
  "ring",
  "leaf",
  "star",
];
const shapeNames = [
  "圆形",
  "菱形",
  "三角形",
  "方形",
  "十字",
  "圆环",
  "叶片",
  "星形",
];
const names = { merge: "数字合成", memory: "记忆翻牌" };
const clock = (ms) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
const uid = () => crypto.randomUUID();
const optionText = (option) =>
  typeof option === "string" ? option : option?.text || option?.label || "";
const unwrap = (value) => value?.session || value;
const glyph = (name) =>
  ({
    quiz: '<path d="M5 4h14v17H5zM9 8h6m-6 4h6m-6 4h3"/>',
    merge:
      '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17h7m-3.5-3.5v7"/>',
    memory:
      '<rect x="3" y="5" width="8" height="15" rx="2"/><rect x="13" y="3" width="8" height="15" rx="2"/><path d="m5 11 2 2 2-2m6-2 2-2 2 2"/>',
  })[name] || '<path d="m14 5-7 7 7 7"/>';
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph(name)}</svg>`;

export function createPlayHub({ api, userId, onNavigate = () => {} }) {
  let root,
    alive = false,
    pulse,
    displayTimer,
    pointer,
    lastClockAt = Date.now(),
    presenceSerial = 0,
    presenceIntent = { id: null, active: false },
    scrollToHead = false;
  const key = "yx.play.pending." + userId;
  const state = {
    mode: "lobby",
    overview: null,
    quiz: null,
    game: null,
    mistakes: [],
    review: null,
    feedback: null,
    question: null,
    busy: false,
    error: "",
    pending: null,
  };
  try {
    state.pending = JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    state.pending = null;
  }
  function savePending(value) {
    state.pending = value;
    try {
      value
        ? localStorage.setItem(key, JSON.stringify(value))
        : localStorage.removeItem(key);
    } catch {}
  }
  const locked = () => state.busy || !!state.pending;
  const disabled = (extra = false) => (locked() || extra ? "disabled" : "");
  function view(mode) {
    if (state.mode !== mode) scrollToHead = true;
    state.mode = mode;
  }
  function setGame(value) {
    const next = unwrap(value),
      old = state.game;
    if (
      old?.id === next?.id &&
      (old.revision > next.revision ||
        (old.revision === next.revision && old.serverTime > next.serverTime))
    )
      return;
    state.game = next;
    lastClockAt = Date.now();
  }
  const foreground = () =>
    alive && root?.isConnected && !document.hidden && state.mode === "game";
  // 序列保护UI之外，还要纠正真正晚到服务器的旧presence写入。
  async function alignPresence(id) {
    if (state.game?.id === id && state.game.status !== "active")
      return state.game;
    const serial = presenceSerial;
    const active =
      foreground() &&
      state.game?.id === id &&
      presenceIntent.id === id &&
      presenceIntent.active;
    const result = await api(`/play/games/${id}/presence`, "POST", { active });
    if (serial !== presenceSerial) return alignPresence(id);
    if (state.game?.id === id) setGame(result);
    return result;
  }
  async function pauseIfInactive(value) {
    const game = unwrap(value);
    if (foreground() || game?.status !== "active") return false;
    const serial = ++presenceSerial;
    if (state.game?.id === game.id)
      presenceIntent = { id: game.id, active: false };
    const paused = await api(`/play/games/${game.id}/presence`, "POST", {
      active: false,
    }).catch(() => null);
    if (paused && serial !== presenceSerial)
      await alignPresence(game.id).catch(() => {});
    else if (paused && state.game?.id === game.id) setGame(paused);
    return true;
  }
  async function perform(fn) {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      await fn();
    } catch (e) {
      state.error = e.message || "连接未确认，请恢复原进度。";
    } finally {
      state.busy = false;
      render();
    }
  }
  const notice = () =>
    '<div class="play-disclosure">内部体验版 · 完整玩法免费，成绩不兑换金币或现金，当前不含广告。</div>';
  const head = (title, subtitle, back = true) =>
    `<header class="play-head">${back ? `<button class="play-back" data-play-back aria-label="返回趣玩大厅">${icon("back")}</button>` : ""}<div><span class="play-eyebrow">A LITTLE CHALLENGE, EVERY DAY</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></header>`;
  function errors() {
    if (!state.error && !state.pending) return "";
    return `<div class="play-error" role="alert"><span>${esc(state.error || "上次操作结果待确认，请先恢复原进度。")}</span><button data-play-retry ${state.busy ? "disabled" : ""}>查询并恢复</button></div>`;
  }
  function best(kind) {
    const item = state.overview?.games?.find((g) => g.kind === kind);
    const value =
      item?.bestScore ??
      state.overview?.stats?.[kind === "merge" ? "bestMerge" : "bestMemory"];
    return typeof value === "number" ? value : value?.score || 0;
  }
  function lobby() {
    if (!state.overview)
      return `${head("趣玩时光", "每天几分钟，给自己一点小挑战。", false)}<div class="play-loading" role="status">正在读取今日挑战…</div>`;
    if (!state.overview.enabled)
      return `${head("趣玩时光", "娱乐体验暂未开放。", false)}<section class="play-panel play-empty"><h2>当前环境未开放娱乐原型</h2><p>微信产品形态及准入仍待核实。此入口不会创建游戏、广告或奖励。</p><button class="play-primary" data-play-home>返回首页</button></section>`;
    const q = state.overview.quiz || state.overview.daily || {},
      answered = q.answered || 0,
      total = q.total || 5;
    return `${head("趣玩时光", "每天几分钟，给自己一点小挑战。", false)}${notice()}<section class="play-today"><div><span class="play-chip">${esc(state.overview.day || "今日")} · 每日更新</span><h2>${q.completed ? "今日挑战已完成，明天再见。" : "今天，来一场轻松的脑力热身。"}</h2><p>答题看解析，合成新数字，记住一组图案。每一局都可以免费完成。</p><button class="play-primary" data-play-open="quiz" ${disabled()}>${q.completed ? "查看今日成绩" : answered ? "继续今日趣答" : "开始今日5题"}<span aria-hidden="true">→</span></button></div><div class="play-daily-meter"><strong>${answered}<small> / ${total}</small></strong><span>今日趣答进度</span><div class="play-meter-bars">${Array.from({ length: total }, (_, i) => `<i class="${i < answered ? "filled" : ""}"></i>`).join("")}</div></div></section><div class="play-section-head"><h2>挑一个喜欢的</h2><span>无需等待，不强制看广告</span></div><div class="play-cards">${[
      {
        kind: "quiz",
        tag: "每日5题",
        title: "每日趣答",
        copy: "成语、自然与生活常识。选一个答案，读懂背后的道理。",
        meta: answered
          ? `今日已答${answered}/${total}题`
          : "每天一组，保存你的答题记录",
      },
      {
        kind: "merge",
        tag: "合成到2048",
        title: "数字合成",
        copy: "滑动相同数字，让它们合成更大的方块。一步一步，突破自己。",
        meta: `个人最高 ${best("merge")} 分`,
      },
      {
        kind: "memory",
        tag: "8组配对",
        title: "记忆翻牌",
        copy: "翻开两张，找到相同图案。给记忆力做一场小小的练习。",
        meta: `个人最高 ${best("memory")} 分`,
      },
    ]
      .map(
        (c) =>
          `<button class="play-game-card play-card-${c.kind}" data-play-open="${c.kind}" ${disabled()}><span class="play-card-art">${icon(c.kind)}</span><span class="play-card-tag">${c.tag}</span><strong>${c.title}</strong><p>${c.copy}</p><span class="play-card-meta">${c.meta}</span><span class="play-card-arrow" aria-hidden="true">↗</span></button>`,
      )
      .join(
        "",
      )}</div><section class="play-panel play-review-link"><span class="play-small-art">${icon("quiz")}</span><div><h3>把错过的知识，再记住一次</h3><p>只保留你实际答错的题目，随时回来复习。</p></div><button class="play-secondary" data-play-mistakes ${disabled()}>我的错题本</button></section><p class="play-footnote">成绩仅供个人记录；不设置虚构排名、在线人数或现金收益。</p>`;
  }
  function quiz() {
    if (!state.quiz)
      return `${head("每日趣答", "每天5题，答案之后还有一点新发现。")}${notice()}<div class="play-loading">正在准备题目…</div>`;
    const q = state.quiz;
    if (q.completed && !state.feedback)
      return `${head("今日成绩", "完成就是收获，明天还有一组新问题。")}${notice()}<section class="play-panel play-quiz-complete"><span class="play-complete-mark">${icon("quiz")}</span><p>${esc(q.day)} · 今日趣答</p><h2>${q.correct}<small> / ${q.total}</small></h2><strong>答对${q.correct}题，完成${q.answered}题</strong><p>已保存真实作答记录。可以查看解析、复习错题，或者换一种玩法。</p><button class="play-primary" data-play-mistakes ${disabled()}>复习我的错题</button><button class="play-secondary" data-play-back>回到趣玩大厅</button></section>`;
    return `${head("每日趣答", "读题、选择、看解析，每天积累一点。")}${notice()}<div class="play-quiz-progress"><span>今日已答 ${q.answered}/${q.total}</span><span>答对 ${q.correct} 题</span></div>${questionPanel(state.feedback ? state.question : q.current, "daily")}`;
  }
  function questionPanel(question, mode) {
    if (!question)
      return '<section class="play-panel play-empty">题目暂未准备好，请恢复进度。</section>';
    const feedback = state.feedback,
      result = feedback ? feedback.answer || feedback : null;
    const choice = result?.choice ?? feedback?.choice;
    return `<section class="play-panel play-question"><div class="play-question-kicker"><span>${esc(question.category || "趣味知识")}</span><span>${mode === "daily" ? `第${Number.isInteger(question.index) ? question.index + 1 : state.quiz.answered + 1}题 / ${state.quiz.total}题` : "错题复习"}</span></div><h2>${esc(question.prompt)}</h2><div class="play-options">${(question.options || []).map((option, i) => `<button class="play-option ${result ? (i === result.correctIndex ? "is-correct" : i === choice ? "is-wrong" : "") : ""}" data-play-answer="${i}" ${mode === "review" ? `data-play-review-answer="${i}"` : ""} ${disabled(!!feedback)}><span>${String.fromCharCode(65 + i)}</span><strong>${esc(optionText(option))}</strong>${result && (i === result.correctIndex || i === choice) ? `<i aria-hidden="true">${i === result.correctIndex ? "✓" : "×"}</i>` : ""}</button>`).join("")}</div>${result ? `<div class="play-explanation ${result.correct ? "is-correct" : "is-wrong"}" role="status"><strong>${result.correct ? "答对了" : "这次没选对，也有新收获"}</strong><p>${esc(result.explanation || "")}</p></div><button class="play-primary" data-play-next ${disabled()}>${mode === "review" ? "返回错题本" : state.quiz.completed ? "查看今日成绩" : "继续下一题"}<span aria-hidden="true">→</span></button>` : '<p class="play-footnote">选择后由服务器判题，未作答前不会显示答案。</p>'}</section>`;
  }
  function mistakes() {
    return `${head("我的错题本", "把没记住的，再温习一次。")}${notice()}${state.mistakes.length ? `<div class="play-mistake-list">${state.mistakes.map((m, i) => `<button class="play-panel play-mistake-item" data-play-review="${esc(m.id)}" ${disabled()}><span class="play-mistake-index">${String(i + 1).padStart(2, "0")}</span><div><small>${esc(m.category || m.question?.category || "趣味知识")} · 答错${m.wrongCount || 1}次</small><strong>${esc(m.prompt || m.question?.prompt)}</strong></div><span aria-hidden="true">→</span></button>`).join("")}</div>` : '<section class="play-panel play-empty"><span class="play-complete-mark">' + icon("quiz") + '</span><h2>暂时没有错题</h2><p>先试试今日5题。这里会收录你实际答错的问题。</p><button class="play-primary" data-play-open="quiz">开始今日趣答</button></section>'}`;
  }
  function game() {
    if (!state.game)
      return `${head("正在准备挑战", "进度以服务器保存为准。")}${notice()}<div class="play-loading">正在恢复棋盘…</div>`;
    const g = state.game,
      s = g.state || {},
      finished = g.status === "finished",
      paused = g.paused;
    const subtitle =
      g.kind === "merge"
        ? "滑动或使用方向键，让相同数字相遇。"
        : "每次翻开两张，寻找相同图案。";
    return `${head(names[g.kind], subtitle)}${notice()}<div class="play-game-layout"><section class="play-game-main"><div class="play-score-row"><div><small>本局${g.kind === "merge" ? "分数" : "配对分"}</small><strong>${g.score ?? s.score ?? 0}</strong></div><div><small>${g.kind === "merge" ? "有效移动" : "配对尝试"}</small><strong>${g.kind === "merge" ? s.moves || 0 : s.attempts || 0}</strong></div><div><small>前台用时</small><strong data-play-time>${clock(g.elapsedMs || 0)}</strong></div></div>${g.kind === "merge" ? mergeBoard(g) : memoryBoard(g)}${finished ? `<div class="play-game-status is-finished"><strong>${s.won ? "挑战完成，做得不错！" : "本局已结束"}</strong><p>个人成绩已保存，不产生金币或现金奖励。</p></div>` : paused ? '<div class="play-game-status"><strong>本局已暂停</strong><p>恢复后继续游玩，暂停时间不计入用时。</p></div>' : g.kind === "memory" && s.phase === "miss" ? '<p class="play-game-hint" role="status">没配上，再记一眼。翻下一张时会盖回这两张。</p>' : s.won ? '<p class="play-game-hint">已合成2048！你可以继续挑战更大的数字。</p>' : '<p class="play-game-hint">无需广告，可免费完成整局。</p>'}<div class="play-game-actions">${finished ? `<button class="play-primary" data-play-restart ${disabled()}>再玩一局</button><button class="play-secondary" data-play-back>回到大厅</button>` : `<button class="play-primary" ${paused ? "data-play-resume" : "data-play-pause"} ${disabled()}>${paused ? "继续本局" : "暂停一下"}</button><button class="play-secondary" data-play-finish ${disabled()}>结束并保存成绩</button>`}</div></section><aside class="play-panel play-game-guide"><span class="play-chip">玩法说明</span><h2>${g.kind === "merge" ? "慢慢想，再走一步。" : "看一眼，记住它。"}</h2>${g.kind === "merge" ? "<ol><li>滑动棋盘、按方向按钮或方向键移动。</li><li>相同数字相遇会合并，一次移动中每格只合并一次。</li><li>不能再移动时结束；合成2048后仍可继续。</li></ol>" : "<ol><li>16张牌中藏着8组相同图案。</li><li>每次翻开两张，配对成功后保持显示。</li><li>全部配对即完成；只记录个人成绩。</li></ol>"}<p>${esc(g.timingNotice || "前台心跳累计用时，离开或断网间隙不计；不作为赛事认证。")}</p><small>网络异常时先恢复原进度，不在本地伪造成功。</small></aside></div>`;
  }
  function mergeBoard(g) {
    const s = g.state,
      off = locked() || g.paused || g.status !== "active" || s.over;
    return `<div class="play-merge-board" data-play-board="merge" data-play-session="${esc(g.id)}" tabindex="0" role="group" aria-label="数字合成棋盘，使用方向键或下方按钮移动">${s.board.map((n, i) => `<div class="play-number-tile value-${n > 2048 ? "large" : n}" aria-label="第${i + 1}格${n ? `，数字${n}` : "，空白"}">${n || ""}</div>`).join("")}</div><div class="play-direction-pad"><button data-play-direction="up" ${off ? "disabled" : ""} aria-label="向上移动">↑</button><button data-play-direction="left" ${off ? "disabled" : ""} aria-label="向左移动">←</button><button data-play-direction="down" ${off ? "disabled" : ""} aria-label="向下移动">↓</button><button data-play-direction="right" ${off ? "disabled" : ""} aria-label="向右移动">→</button></div>`;
  }
  function memoryBoard(g) {
    const s = g.state;
    return `<div class="play-memory-board" data-play-board="memory" data-play-session="${esc(g.id)}" role="group" aria-label="记忆翻牌，16张牌">${s.cards
      .map((card, index) => {
        const shown = card !== null && card !== undefined,
          matched = s.matched.includes(index);
        return `<button class="play-memory-card ${shown ? "is-open" : ""} ${matched ? "is-matched" : ""}" data-play-card="${index}" ${disabled(g.paused || g.status !== "active" || matched)} aria-label="第${index + 1}张牌，${matched ? "已配对，" : ""}${shown ? shapeNames[card] || "图案" : "未翻开"}">${shown ? `<span class="play-shape shape-${shapes[card] || "circle"} color-${card}" aria-hidden="true"></span>` : '<span class="play-card-back" aria-hidden="true">享</span>'}</button>`;
      })
      .join(
        "",
      )}</div><p class="play-memory-progress">已配对 ${s.matched.length / 2} / ${s.pairs || s.cards.length / 2} 组</p>`;
  }
  function render() {
    if (!alive || !root?.isConnected) return;
    const focus = document.activeElement,
      boardFocused = focus?.matches?.('[data-play-board="merge"]');
    root.setAttribute("aria-busy", String(state.busy));
    root.innerHTML = `<div class="play-page">${errors()}${state.mode === "lobby" ? lobby() : state.mode === "quiz" ? quiz() : state.mode === "mistakes" ? mistakes() : state.mode === "review" ? `${head("错题复习", "选一个答案，再读一次解析。")}${notice()}${questionPanel(state.question, "review")}` : game()}</div>`;
    if (scrollToHead) {
      window.scrollTo(0, 0);
      scrollToHead = false;
    }
    if (boardFocused && state.mode === "game")
      root
        .querySelector('[data-play-board="merge"]')
        ?.focus({ preventScroll: true });
  }
  async function overview() {
    state.overview = await api("/play/overview");
  }
  async function lobbyOpen() {
    if (state.game?.status === "active")
      await api(`/play/games/${state.game.id}/presence`, "POST", {
        active: false,
      }).catch(() => {});
    view("lobby");
    state.feedback = null;
    await overview();
  }
  async function openQuiz() {
    view("quiz");
    state.feedback = null;
    state.quiz = await api("/play/quiz");
  }
  async function openMistakes() {
    view("mistakes");
    state.feedback = null;
    state.mistakes = (await api("/play/mistakes")).items || [];
  }
  async function createGame(kind, restart = false) {
    view("game");
    state.game = null;
    const pending = {
      type: "create",
      uri: "/play/games",
      body: { kind, requestKey: uid(), ...(restart ? { restart: true } : {}) },
    };
    savePending(pending);
    const created = await api(pending.uri, "POST", pending.body);
    setGame(created);
    savePending(null);
    if (await pauseIfInactive(created)) return;
    if (state.game.status === "active") await presence(true);
  }
  async function gameAction(body, finish = false) {
    if (
      !state.game ||
      state.game.status !== "active" ||
      (!finish && state.game.paused) ||
      locked()
    )
      return;
    await perform(async () => {
      const pending = {
        type: "game",
        gameId: state.game.id,
        revision: state.game.revision,
        uri: `/play/games/${state.game.id}/${finish ? "finish" : "action"}`,
        body: { ...body, actionId: uid(), revision: state.game.revision },
      };
      savePending(pending);
      const result = await api(pending.uri, "POST", pending.body);
      setGame(result);
      savePending(null);
      await pauseIfInactive(result);
    });
  }
  async function answer(choice) {
    const review = state.mode === "review",
      question = review ? state.question : state.quiz?.current;
    if (!question || state.feedback || locked()) return;
    await perform(async () => {
      state.question = { ...question };
      const pending = {
        type: review ? "review" : "quiz",
        question: state.question,
        choice,
        uri: review
          ? `/play/mistakes/${state.review.id}/answer`
          : `/play/quiz/${state.quiz.id}/answer`,
        body: review ? { choice } : { questionId: question.id, choice },
      };
      savePending(pending);
      const result = await api(pending.uri, "POST", pending.body);
      if (!review) state.quiz = result.session;
      state.feedback = { ...(result.answer || result), choice };
      savePending(null);
    });
  }
  async function recoverPending() {
    const p = state.pending;
    if (!p) {
      if (state.mode === "game" && state.game)
        setGame(await api(`/play/games/${state.game.id}`));
      else if (state.mode === "quiz") await openQuiz();
      else if (state.mode === "mistakes") await openMistakes();
      else await overview();
      return;
    }
    if (p.type === "game") {
      view("game");
      setGame(await api(`/play/games/${p.gameId}`));
      if (await pauseIfInactive(state.game)) return;
      if (
        state.game.revision === p.revision &&
        state.game.status === "active"
      ) {
        // 用户明确选择“查询并恢复”后，先恢复暂停棋局再重放原动作。
        if (state.game.paused) await presence(true);
        if (await pauseIfInactive(state.game)) return;
        setGame(await api(p.uri, "POST", p.body));
      }
      savePending(null);
      await pauseIfInactive(state.game);
    } else if (p.type === "create") {
      view("game");
      setGame(await api(p.uri, "POST", p.body));
      savePending(null);
      await pauseIfInactive(state.game);
    } else {
      const result = await api(p.uri, "POST", p.body);
      view(p.type === "quiz" ? "quiz" : "review");
      state.question = p.question;
      if (p.type === "quiz") state.quiz = result.session;
      state.feedback = { ...(result.answer || result), choice: p.choice };
      savePending(null);
    }
  }
  async function recover() {
    try {
      await recoverPending();
    } catch (e) {
      if (
        e.status !== 400 &&
        e.status !== 404 &&
        !["PLAY_QUIZ_EXPIRED", "PLAY_ANSWER_CONFLICT"].includes(e.code)
      )
        throw e;
      savePending(null);
      state.game = null;
      state.feedback = null;
      view("lobby");
      await overview();
      state.error = `${e.message}；已清理无效的本机请求，请重新打开今日挑战或服务端保存的棋局。`;
    }
  }
  async function presence(active) {
    if (!state.game || state.game.status !== "active") return;
    const id = state.game.id,
      serial = ++presenceSerial;
    presenceIntent = { id, active: active && foreground() };
    const result = await api(`/play/games/${id}/presence`, "POST", {
      active: presenceIntent.active,
    });
    if (serial !== presenceSerial) await alignPresence(id);
    else if (state.game?.id === id) setGame(result);
    if (active) await pauseIfInactive(result);
  }
  function click(event) {
    const b = event.target.closest("button");
    if (!b || !root.contains(b) || b.disabled || state.busy) return;
    if (b.hasAttribute("data-play-retry")) {
      perform(recover);
      return;
    }
    if (b.hasAttribute("data-play-home")) {
      onNavigate("home");
      return;
    }
    if (b.hasAttribute("data-play-back")) {
      perform(lobbyOpen);
      return;
    }
    if (locked()) return;
    if (b.dataset.playOpen) {
      perform(() =>
        b.dataset.playOpen === "quiz"
          ? openQuiz()
          : createGame(b.dataset.playOpen),
      );
      return;
    }
    if (b.hasAttribute("data-play-mistakes")) {
      perform(openMistakes);
      return;
    }
    if (b.dataset.playReview) {
      state.review = state.mistakes.find((m) => m.id === b.dataset.playReview);
      state.question = { ...state.review.question, ...state.review };
      state.feedback = null;
      view("review");
      render();
      return;
    }
    if (b.dataset.playAnswer !== undefined) {
      answer(Number(b.dataset.playAnswer));
      return;
    }
    if (b.hasAttribute("data-play-next")) {
      state.feedback = null;
      scrollToHead = true;
      if (state.mode === "review") perform(openMistakes);
      else render();
      return;
    }
    if (b.dataset.playDirection) {
      gameAction({ direction: b.dataset.playDirection });
      return;
    }
    if (b.dataset.playCard !== undefined) {
      gameAction({ index: Number(b.dataset.playCard) });
      return;
    }
    if (b.hasAttribute("data-play-finish")) {
      gameAction({}, true);
      return;
    }
    if (b.hasAttribute("data-play-restart")) {
      perform(() => createGame(state.game.kind, true));
      return;
    }
    if (b.hasAttribute("data-play-pause")) {
      perform(() => presence(false));
      return;
    }
    if (b.hasAttribute("data-play-resume")) {
      perform(() => presence(true));
      return;
    }
  }
  function keydown(e) {
    const direction = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    }[e.key];
    if (
      !direction ||
      state.mode !== "game" ||
      state.game?.kind !== "merge" ||
      !root.contains(document.activeElement)
    )
      return;
    e.preventDefault();
    gameAction({ direction });
  }
  function down(e) {
    if (e.target.closest('[data-play-board="merge"]'))
      pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function up(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x,
      dy = e.clientY - pointer.y;
    pointer = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    gameAction({
      direction:
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "right"
            : "left"
          : dy > 0
            ? "down"
            : "up",
    });
  }
  function visibility() {
    if (state.mode !== "game" || state.game?.status !== "active") return;
    if (document.hidden) presence(false).catch(() => {});
    else
      perform(() => {
        return presence(false);
      });
  }
  return {
    async mount(element) {
      root = element;
      alive = true;
      root.addEventListener("click", click);
      root.addEventListener("pointerdown", down);
      root.addEventListener("pointerup", up);
      document.addEventListener("keydown", keydown);
      document.addEventListener("visibilitychange", visibility);
      await perform(overview);
      if (!alive) return;
      pulse = setInterval(() => {
        if (
          alive &&
          !state.busy &&
          !state.pending &&
          !document.hidden &&
          state.mode === "game" &&
          state.game?.status === "active" &&
          !state.game.paused
        )
          presence(true)
            .then(render)
            .catch(() => {});
      }, 5000);
      displayTimer = setInterval(() => {
        const el = root?.querySelector("[data-play-time]");
        if (
          el &&
          state.game?.status === "active" &&
          !state.game.paused &&
          !document.hidden
        )
          el.textContent = clock(
            (state.game.elapsedMs || 0) +
              Math.min(5000, Math.max(0, Date.now() - lastClockAt)),
          );
      }, 1000);
    },
    dispose() {
      alive = false;
      ++presenceSerial;
      presenceIntent = { id: state.game?.id || null, active: false };
      clearInterval(pulse);
      clearInterval(displayTimer);
      root?.removeEventListener("click", click);
      root?.removeEventListener("pointerdown", down);
      root?.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("visibilitychange", visibility);
      if (state.game?.status === "active")
        api(`/play/games/${state.game.id}/presence`, "POST", {
          active: false,
        }).catch(() => {});
    },
  };
}
