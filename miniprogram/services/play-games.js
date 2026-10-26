/* 原创数字合成与记忆配对规则。纯函数，供浏览器、原生及服务端共用。
 * 发奖、计时与成绩接收均不在本模块；服务器保留权威状态和随机源。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlayGames = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  const directions = ["left", "right", "up", "down"];
  function random(rng) {
    const n = (rng || Math.random)();
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error("随机源无效");
    return n;
  }
  function canMoveMerge(board) {
    if (board.includes(0)) return true;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        const i = r * 4 + c;
        if (
          (c < 3 && board[i] === board[i + 1]) ||
          (r < 3 && board[i] === board[i + 4])
        )
          return true;
      }
    return false;
  }
  function spawn(board, rng) {
    const free = board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    if (free.length)
      board[free[Math.floor(random(rng) * free.length)]] =
        random(rng) < 0.9 ? 2 : 4;
  }
  function validMerge(state) {
    if (
      !state ||
      !Array.isArray(state.board) ||
      state.board.length !== 16 ||
      !state.board.every(
        (n) =>
          Number.isSafeInteger(n) &&
          n >= 0 &&
          (n === 0 || (n >= 2 && Math.log2(n) % 1 === 0)),
      )
    )
      throw new Error("数字棋盘无效");
    if (
      !Number.isSafeInteger(state.score) ||
      state.score < 0 ||
      !Number.isSafeInteger(state.moves) ||
      state.moves < 0
    )
      throw new Error("数字成绩无效");
  }
  function createMerge(rng) {
    const board = Array(16).fill(0);
    spawn(board, rng);
    spawn(board, rng);
    return {
      kind: "merge",
      board,
      score: 0,
      moves: 0,
      won: false,
      over: false,
      changed: true,
    };
  }
  function moveMerge(state, direction, rng) {
    validMerge(state);
    if (!directions.includes(direction)) throw new Error("移动方向无效");
    const board = [...state.board];
    if (state.over) return { ...state, board, changed: false };
    let gained = 0;
    for (let line = 0; line < 4; line++) {
      const indices = Array.from({ length: 4 }, (_, pos) =>
        direction === "left"
          ? line * 4 + pos
          : direction === "right"
            ? line * 4 + 3 - pos
            : direction === "up"
              ? pos * 4 + line
              : (3 - pos) * 4 + line,
      );
      const values = indices.map((i) => state.board[i]).filter(Boolean),
        merged = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === values[i + 1]) {
          merged.push(values[i] * 2);
          gained += values[i] * 2;
          i++;
        } else merged.push(values[i]);
      }
      while (merged.length < 4) merged.push(0);
      indices.forEach((index, pos) => {
        board[index] = merged[pos];
      });
    }
    const changed = board.some((value, index) => value !== state.board[index]);
    if (!changed)
      return { ...state, board, over: !canMoveMerge(board), changed: false };
    spawn(board, rng);
    return {
      kind: "merge",
      board,
      score: state.score + gained,
      moves: state.moves + 1,
      won: state.won || board.some((n) => n >= 2048),
      over: !canMoveMerge(board),
      changed: true,
    };
  }
  function createMemory(rng, pairs = 6) {
    if (!Number.isInteger(pairs) || pairs < 2 || pairs > 12)
      throw new Error("配对数量无效");
    const cards = Array.from({ length: pairs * 2 }, (_, i) => i % pairs);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random(rng) * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return {
      kind: "memory",
      cards,
      open: [],
      matched: [],
      pairs,
      attempts: 0,
      moves: 0,
      score: 0,
      won: false,
      over: false,
      changed: true,
      phase: "idle",
    };
  }
  function flipMemory(state, index) {
    if (
      !state ||
      !Array.isArray(state.cards) ||
      !Array.isArray(state.matched) ||
      !Array.isArray(state.open) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= state.cards.length
    )
      throw new Error("翻牌位置无效");
    const next = {
      ...state,
      cards: [...state.cards],
      matched: [...state.matched],
      open: state.open.length === 2 ? [] : [...state.open],
      changed: false,
    };
    if (state.over || next.matched.includes(index) || next.open.includes(index))
      return { ...next, open: [...state.open] };
    next.open.push(index);
    next.moves++;
    next.changed = true;
    next.phase = "one";
    if (next.open.length === 2) {
      next.attempts++;
      if (next.cards[next.open[0]] === next.cards[next.open[1]]) {
        next.matched.push(...next.open);
        next.open = [];
        next.score += 100;
        next.phase = "match";
        next.won = next.matched.length === next.cards.length;
        next.over = next.won;
        if (next.won) next.phase = "complete";
      } else next.phase = "miss";
    }
    return next;
  }
  function settleMemory(state) {
    return {
      ...state,
      cards: [...state.cards],
      matched: [...state.matched],
      open: state.open.length === 2 ? [] : [...state.open],
      phase: state.open.length === 2 ? "idle" : state.phase,
      changed: state.open.length === 2,
    };
  }
  function publicMemory(state) {
    const visible = new Set([...state.open, ...state.matched]);
    return {
      ...state,
      cards: state.cards.map((card, index) =>
        visible.has(index) ? card : null,
      ),
      open: [...state.open],
      matched: [...state.matched],
    };
  }
  return {
    directions,
    createMerge,
    moveMerge,
    canMoveMerge,
    createMemory,
    flipMemory,
    settleMemory,
    publicMemory,
  };
});
