const api = require("../../services/client");
const letters = ["A", "B", "C", "D"];
const shapes = [
  "circle",
  "diamond",
  "triangle",
  "square",
  "cross",
  "ring",
  "leaf",
  "bow",
];
const names = { merge: "数字合成", memory: "记忆翻牌" };
function key(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 12)
  );
}
function clock(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return (
    String(Math.floor(seconds / 60)).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}
Page({
  data: {
    screen: "hub",
    loading: true,
    busy: false,
    error: "",
    pending: false,
    overview: null,
    enabled: false,
    records: [],
    day: "",
    quiz: null,
    question: null,
    choices: [],
    selected: -1,
    answer: null,
    quizPercent: 0,
    review: [],
    game: null,
    gameCells: [],
    gameTitle: "",
    timeLabel: "00:00",
    gamePaused: false,
    bestScore: 0,
    gameNotice: "",
    quizResults: [],
  },
  update(patch) {
    if (!this._disposed) this.setData(patch);
  },
  onShow() {
    this._lifecycle = (this._lifecycle || 0) + 1;
    this._disposed = false;
    this._visible = true;
    clearInterval(this._clock);
    clearInterval(this._heartbeat);
    this.load();
    this._clock = setInterval(() => this.tick(), 1000);
    this._heartbeat = setInterval(() => this.presence(), 5000);
  },
  onHide() {
    return this.leave();
  },
  onUnload() {
    this.leave();
    this._disposed = true;
  },
  leave() {
    this._lifecycle = (this._lifecycle || 0) + 1;
    this._presenceSeq = (this._presenceSeq || 0) + 1;
    this._visible = false;
    clearInterval(this._clock);
    clearInterval(this._heartbeat);
    if (this.data.game?.status === "active") {
      this.update({ gamePaused: true });
      return this.setPresence(false).catch(() => {});
    }
  },
  async load() {
    const lifecycle = this._lifecycle || 0;
    this.update({ loading: true, error: "" });
    try {
      await getApp().ready();
      const [overview, me] = await Promise.all([
        api.request("/api/play"),
        api.request("/api/me"),
      ]);
      if (lifecycle !== (this._lifecycle || 0) || this._disposed) return;
      this._storageKey = "yx_play_pending_" + me.id;
      this._pending = wx.getStorageSync(this._storageKey) || null;
      this.showOverview(overview);
      this.update({ pending: !!this._pending });
      if (!overview.enabled) return;
      if (this.data.game && this.data.screen === "game") {
        const game = await api.request("/api/play/games/" + this.data.game.id);
        if (lifecycle !== (this._lifecycle || 0) || this._disposed) return;
        this.showGame(game);
        if (!this._pending && this._visible) await this.setPresence(true);
      }
    } catch (e) {
      this.update({ error: e.message || "暂时无法读取趣玩内容，请重试。" });
    } finally {
      this.update({ loading: false });
    }
  },
  showOverview(overview) {
    const records = (overview.games || []).map((g) => ({
      ...g,
      title: names[g.kind] || g.title,
      resumable: g.lastSession?.status === "active",
    }));
    this.update({
      overview,
      enabled: !!overview.enabled,
      day: overview.day,
      records,
    });
  },
  async refreshOverview() {
    this.showOverview(await api.request("/api/play"));
  },
  async run(fn) {
    if (this.data.busy) return;
    this.update({ busy: true, error: "" });
    try {
      await fn();
    } catch (e) {
      this.update({
        error: e.message || "网络异常，请重试原操作。",
        pending: !!this._pending,
      });
    } finally {
      this.update({ busy: false });
    }
  },
  savePending(value) {
    this._pending = value;
    if (this._storageKey) {
      if (value) wx.setStorageSync(this._storageKey, value);
      else wx.removeStorageSync(this._storageKey);
    }
    this.update({ pending: !!value });
  },
  async mutate(path, body, type, meta = {}) {
    if (this._pending) throw new Error("请先查询刚才的操作结果，再继续。");
    const pending = { path, body, type, meta };
    this.savePending(pending);
    return this.sendPending();
  },
  async sendPending() {
    const pending = this._pending;
    if (!pending) return;
    const lifecycle = this._lifecycle || 0;
    try {
      const result = await api.request(pending.path, "POST", pending.body);
      this.savePending(null);
      await this.applyResult(pending, result, lifecycle);
    } catch (e) {
      if (e.status >= 400 && e.status < 500) {
        this.savePending(null);
        if (pending.meta.gameId) {
          try {
            this.showGame(
              await api.request("/api/play/games/" + pending.meta.gameId),
            );
          } catch (_) {}
        }
      }
      throw e;
    }
  },
  async retryPending() {
    return this.run(async () => {
      const pending = this._pending;
      if (!pending || !this._visible) return;
      const id = pending.meta.gameId;
      if (id && pending.path.endsWith("/action")) {
        const current = await api.request("/api/play/games/" + id);
        this.showGame(current);
        if (!this._visible) return;
        if (current.status === "active" && current.paused)
          await this.setPresence(true);
        if (!this._visible) return;
      }
      await this.sendPending();
      if (id && this._visible)
        this.showGame(await api.request("/api/play/games/" + id));
    });
  },
  async applyResult(pending, result, lifecycle) {
    if (pending.type === "quiz") {
      this.showQuiz(result.session, pending.meta.question, result.answer);
      if (result.session.completed) await this.refreshOverview();
    } else if (pending.type === "review") {
      this.showQuestion(
        pending.meta.question,
        result.answer || result,
        "review-question",
      );
    } else {
      let session = result.session || result;
      const stale = lifecycle !== (this._lifecycle || 0);
      if ((this._visible === false || stale) && session.status === "active") {
        const paused = await api.request(
          "/api/play/games/" + session.id + "/presence",
          "POST",
          { active: false },
        );
        session = paused.session || paused;
      }
      this.showGame(session, !stale);
      if (
        pending.meta.resume &&
        this._visible &&
        !stale &&
        this.data.game.status === "active"
      )
        await this.setPresence(true);
      if (this.data.game.status === "finished") await this.refreshOverview();
    }
  },
  async openQuiz() {
    if (!this.data.enabled || this.data.pending) return;
    return this.run(async () =>
      this.showQuiz(await api.request("/api/play/quiz")),
    );
  },
  showQuiz(session, question = null, answer = null) {
    this.update({
      quiz: session,
      quizPercent: session.total
        ? Math.round((session.answered / session.total) * 100)
        : 0,
      quizResults: (session.results || []).map((r) => ({
        ...r,
        correctText: r.options?.[r.correctIndex] || "",
        pickedText: r.options?.[r.choice] || "",
      })),
    });
    this.showQuestion(question || session.current, answer, "quiz");
  },
  showQuestion(question, answer = null, screen = "quiz") {
    const options = question?.options || [];
    this.update({
      screen,
      question,
      selected: answer ? answer.choice : -1,
      answer,
      choices: options.map((text, index) => ({
        index,
        text,
        letter: letters[index],
        selected: answer?.choice === index,
        correct: !!answer && answer.correctIndex === index,
        wrong: !!answer && answer.choice === index && !answer.correct,
      })),
    });
  },
  selectChoice(e) {
    if (this.data.busy || this.data.pending || this.data.answer) return;
    const selected = Number(e.currentTarget.dataset.index);
    this.update({
      selected,
      choices: this.data.choices.map((c) => ({
        ...c,
        selected: c.index === selected,
      })),
    });
  },
  async submitAnswer() {
    if (
      !this.data.question ||
      this.data.selected < 0 ||
      this.data.answer ||
      this.data.pending
    )
      return;
    return this.run(async () => {
      const question = this.data.question,
        choice = this.data.selected;
      if (this.data.screen === "review-question")
        await this.mutate(
          "/api/play/mistakes/" + question.id + "/answer",
          { choice },
          "review",
          { question },
        );
      else
        await this.mutate(
          "/api/play/quiz/" + this.data.quiz.id + "/answer",
          { questionId: question.id, choice },
          "quiz",
          { question },
        );
    });
  },
  nextQuestion() {
    if (this.data.screen === "review-question") return this.openReview();
    this.showQuiz(this.data.quiz);
  },
  async openReview() {
    if (!this.data.enabled || this.data.pending) return;
    return this.run(async () => {
      const result = await api.request("/api/play/mistakes");
      this.update({
        screen: "review",
        review: (result.items || []).map((r) => ({
          ...r,
          id: r.question?.id || r.id,
          question: r.question || r,
        })),
      });
    });
  },
  practice(e) {
    const item = this.data.review[Number(e.currentTarget.dataset.index)];
    if (item && !this.data.busy)
      this.showQuestion(item.question, null, "review-question");
  },
  async startGame(e) {
    if (!this.data.enabled || this.data.pending) return;
    const kind = e.currentTarget.dataset.kind;
    if (!["merge", "memory"].includes(kind)) return;
    return this.run(() =>
      this.mutate(
        "/api/play/games",
        { kind, requestKey: key("start") },
        "game",
        { resume: true },
      ),
    );
  },
  showGame(value, reveal = true) {
    const game = value.session || value,
      s = game.state || {},
      memory = game.kind === "memory";
    const current = this.data.game;
    if (
      current?.id === game.id &&
      (current.revision > game.revision ||
        (current.revision === game.revision &&
          current.serverTime > game.serverTime))
    )
      return;
    const values = memory ? s.cards || [] : s.board || [];
    const gameCells = values.map((value, index) => ({
      index,
      value: memory ? "" : value || "",
      tone: value ? Math.min(12, Math.round(Math.log2(value))) : 0,
      revealed: memory && value !== null,
      matched: memory && (s.matched || []).includes(index),
      shape: memory && value !== null ? shapes[value % shapes.length] : "",
      symbol: memory && value !== null ? String(value + 1) : "",
    }));
    const record = this.data.records.find((r) => r.kind === game.kind);
    this._elapsedBase = game.elapsedMs || 0;
    this._elapsedAt = Date.now();
    let gameNotice = "";
    if (game.status === "finished")
      gameNotice = s.won
        ? "挑战完成，个人成绩已保存。"
        : "本局已结束，个人成绩已保存。";
    else if (memory && s.phase === "miss")
      gameNotice = "这两张没有配对。点下一张时，它们会收起。";
    else if (memory && s.phase === "match")
      gameNotice = "配对成功，继续寻找下一组。";
    else if (!memory && s.won)
      gameNotice = "已合成2048，还可以继续挑战更高数字。";
    this.update({
      screen: this._visible === false || !reveal ? this.data.screen : "game",
      game,
      gameCells,
      gameTitle: names[game.kind],
      gamePaused: !!game.paused,
      timeLabel: clock(game.elapsedMs || 0),
      bestScore: record?.bestScore || 0,
      gameNotice,
    });
  },
  async gameAction(action) {
    const game = this.data.game;
    if (
      !game ||
      game.status !== "active" ||
      this.data.gamePaused ||
      this.data.pending ||
      !this._visible
    )
      return;
    return this.run(() =>
      this.mutate(
        "/api/play/games/" + game.id + "/action",
        { actionId: key("action"), revision: game.revision, ...action },
        "game",
        { gameId: game.id },
      ),
    );
  },
  move(e) {
    return this.gameAction({ direction: e.currentTarget.dataset.direction });
  },
  flip(e) {
    return this.gameAction({ index: Number(e.currentTarget.dataset.index) });
  },
  touchStart(e) {
    if (e.touches?.length === 1)
      this._touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  },
  touchMove() {},
  touchEnd(e) {
    const start = this._touch,
      end = e.changedTouches?.[0];
    this._touch = null;
    if (!start || !end || this.data.game?.kind !== "merge") return;
    const dx = end.clientX - start.x,
      dy = end.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    return this.gameAction({
      direction:
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "right"
            : "left"
          : dy > 0
            ? "down"
            : "up",
    });
  },
  async setPresence(active) {
    const game = this.data.game;
    if (!game || game.status !== "active") return;
    const seq = (this._presenceSeq = (this._presenceSeq || 0) + 1);
    const lifecycle = this._lifecycle || 0;
    this._presenceIntent = { id: game.id, active };
    const result = await api.request(
      "/api/play/games/" + game.id + "/presence",
      "POST",
      { active },
    );
    const session = result.session || result;
    if (
      this._visible === false ||
      this._disposed ||
      this.data.game?.id !== game.id
    ) {
      if (session.status === "active" && !session.paused)
        await api.request("/api/play/games/" + game.id + "/presence", "POST", {
          active: false,
        });
      return;
    }
    if (seq !== this._presenceSeq || lifecycle !== (this._lifecycle || 0)) {
      const intent = this._presenceIntent;
      if (
        session.status === "active" &&
        intent?.id === game.id &&
        session.paused !== !intent.active
      )
        await this.setPresence(intent.active);
      return;
    }
    if (
      this._visible !== false &&
      this.data.screen === "game" &&
      this.data.game?.id === game.id &&
      session.revision >= this.data.game.revision
    )
      this.showGame(session);
  },
  presence() {
    if (
      !this._visible ||
      this.data.screen !== "game" ||
      this.data.gamePaused ||
      this.data.busy ||
      this.data.pending
    )
      return;
    this.setPresence(true).catch(() => {});
  },
  async togglePause() {
    if (this.data.pending) return;
    return this.run(() => this.setPresence(this.data.gamePaused));
  },
  tick() {
    if (
      this._visible &&
      this.data.screen === "game" &&
      this.data.game?.status === "active" &&
      !this.data.gamePaused
    )
      this.update({
        timeLabel: clock(
          (this._elapsedBase || 0) +
            Math.min(10000, Math.max(0, Date.now() - this._elapsedAt)),
        ),
      });
  },
  async restart() {
    if (!this.data.game || this.data.pending) return;
    const reply = await api.modal({
      title: "重新开始一局？",
      content: "当前进度将结束，开启一局新挑战。不会消耗金币或观看广告。",
      confirmText: "重新开始",
    });
    if (!reply.confirm) return;
    return this.run(() =>
      this.mutate(
        "/api/play/games",
        {
          kind: this.data.game.kind,
          requestKey: key("restart"),
          restart: true,
        },
        "game",
      ),
    );
  },
  async finishGame() {
    const game = this.data.game;
    if (!game || game.status !== "active" || this.data.pending) return;
    const reply = await api.modal({
      title: "结束并保存本局？",
      content: "保存当前实际成绩。未完成配对会按本局进度记录。",
      confirmText: "结束本局",
    });
    if (!reply.confirm) return;
    return this.run(() =>
      this.mutate(
        "/api/play/games/" + game.id + "/finish",
        { actionId: key("finish"), revision: game.revision },
        "game",
        { gameId: game.id },
      ),
    );
  },
  async back() {
    if (this.data.busy) return;
    if (this.data.pending) {
      this.update({ error: "先查询刚才的操作结果，避免遗漏当前进度。" });
      return;
    }
    return this.run(async () => {
      if (this.data.screen === "game" && this.data.game?.status === "active")
        await this.setPresence(false);
      this.update({ screen: "hub", question: null, answer: null });
      await this.refreshOverview();
    });
  },
});
