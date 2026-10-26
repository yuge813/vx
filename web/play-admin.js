import { esc, date, toast } from "./shared.js";

const labels = { draft: "待发布草稿", published: "已发布", disabled: "已停用" };
const letters = ["A", "B", "C", "D"];
const fresh = () => ({
  questionId: "",
  version: "",
  category: "成语",
  prompt: "",
  options: ["", "", "", ""],
  correctIndex: 0,
  explanation: "",
  sourceNote: "运营自编；答案与解析待核对",
});
let state = {
  draft: fresh(),
  dirty: false,
  filters: { q: "", state: "", category: "" },
  queryResult: null,
  review: null,
  error: "",
  working: false,
};
let context = null;
const el = (selector) => document.querySelector(selector);
const copyQuestion = (q) => ({
  questionId: q.id,
  version: q.version,
  category: q.category,
  prompt: q.prompt,
  options: [...q.options],
  correctIndex: q.correctIndex,
  explanation: q.explanation,
  sourceNote: q.sourceNote,
});
export function resetPlayAdmin() {
  state = {
    draft: fresh(),
    dirty: false,
    filters: { q: "", state: "", category: "" },
    queryResult: null,
    review: null,
    error: "",
    working: false,
  };
}
function questions(data) {
  return (
    state.queryResult ||
    data.playQuestions || { items: [], total: 0, categories: [] }
  );
}
function question(data, id) {
  return (
    questions(data).items.find((q) => q.id === id) ||
    data.playQuestions?.items.find((q) => q.id === id)
  );
}
function field(name, label, value, attrs = "") {
  return `<label class="field-label">${label}<input class="field" name="${name}" value="${esc(value)}" ${attrs}></label>`;
}
function editor(data) {
  const d = state.draft,
    original = d.questionId ? question(data, d.questionId) : null;
  const stale = original && Number(d.version) !== original.version;
  return `<section class="card play-editor"><div class="row"><h3>${d.questionId ? "编辑题目草稿" : "新增原创题目"}</h3><span class="play-editor-status">${state.dirty ? "尚未保存" : d.questionId ? "已载入" : "先保存，再审核"}</span></div>
  <p class="caption">保存只修改草稿，已发布内容与已生成题单不被替换。审核发布后，新题单才使用新版。</p>
  ${stale ? `<div class="notice">服务器已有v${original.version}，本地编辑基于v${esc(d.version)}。请先保存自己的修改文本，再<button class="link" type="button" data-play-reload="${esc(d.questionId)}">重新载入服务器版本</button>。</div>` : ""}
  <form id="play-question-form"><input type="hidden" name="questionId" value="${esc(d.questionId)}"><input type="hidden" name="version" value="${esc(d.version)}">
  ${field("category", "分类", d.category, 'maxlength="20" required')}
  <label class="field-label">题目<textarea class="field" name="prompt" rows="3" minlength="4" maxlength="180" required placeholder="明确描述问题，避免歧义">${esc(d.prompt)}</textarea></label>
  <fieldset class="play-options"><legend>四个选项</legend>${d.options.map((o, i) => field("option" + i, letters[i] + "选项", o, 'maxlength="60" required')).join("")}</fieldset>
  <label class="field-label">正确答案<select class="field" name="correctIndex">${letters.map((l, i) => `<option value="${i}" ${Number(d.correctIndex) === i ? "selected" : ""}>${l}选项</option>`).join("")}</select></label>
  <label class="field-label">答案解析<textarea class="field" name="explanation" rows="3" minlength="4" maxlength="400" required placeholder="说明依据和推导，不能只重复答案">${esc(d.explanation)}</textarea></label>
  <label class="field-label">内容来源与权利说明<textarea class="field" name="sourceNote" rows="2" minlength="4" maxlength="200" required placeholder="自编题目，或记录授权、许可与出处">${esc(d.sourceNote)}</textarea></label>
  <div class="play-form-actions"><button class="button small" type="submit" ${state.working ? "disabled" : ""}>保存草稿</button><button class="button small light" type="button" data-play-new ${state.working ? "disabled" : ""}>清空 / 新增</button></div></form></section>`;
}
function list(data) {
  const q = questions(data),
    f = state.filters;
  const categories = [
    ...new Set([
      ...(q.categories || []),
      ...(data.playQuestions?.categories || []),
    ]),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const rows = (q.items || []).filter(
    (v) =>
      (!f.q ||
        `${v.prompt} ${v.category} ${v.id}`
          .toLowerCase()
          .includes(f.q.toLowerCase())) &&
      (!f.state || v.state === f.state) &&
      (!f.category || v.category === f.category),
  );
  return `<section class="card play-library"><div class="row"><h3>题库内容</h3><button class="button small light" type="button" data-play-refresh ${state.working ? "disabled" : ""}>刷新题库</button></div>
  <form id="play-question-filter" class="play-filter"><label class="field-label">关键词<input class="field" name="q" maxlength="100" value="${esc(f.q)}" placeholder="题目、分类或编号"></label><label class="field-label">状态<select class="field" name="state"><option value="">全部状态</option>${Object.entries(
    labels,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${f.state === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field-label">分类<select class="field" name="category"><option value="">全部分类</option>${categories.map((v) => `<option value="${esc(v)}" ${f.category === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label><button class="button small" type="submit" ${state.working ? "disabled" : ""}>筛选</button></form>
  <p class="caption">当前显示${rows.length}条 · 查询匹配${q.total || 0}条，接口最多返回200条。已发布题目也可以存在待审核的新草稿。</p>
  <div class="play-question-list">${rows.map((v) => `<article class="play-question-item" data-play-question="${esc(v.id)}"><div class="row"><span class="play-category">${esc(v.category)}</span><span class="play-state state-${esc(v.state)}">${labels[v.state] || "待核实"}</span></div><h4>${esc(v.prompt)}</h4><div class="play-version">草稿v${v.version} · ${v.publishedVersion ? "发布v" + v.publishedVersion : "尚未发布"}${v.hasUnpublishedChanges ? " · 有未发布修改" : ""}${v.enabled && v.hasUnpublishedChanges ? "，旧发布版仍可出题" : ""}</div><details><summary>检查选项、答案和来源</summary><ol class="play-answer-options" type="A">${v.options.map((o, i) => `<li class="${i === v.correctIndex ? "correct" : ""}">${esc(o)}${i === v.correctIndex ? "（正确）" : ""}</li>`).join("")}</ol><p class="play-explanation">${esc(v.explanation)}</p><p class="caption">来源：${esc(v.sourceNote)}</p>${v.updatedAt ? `<p class="caption">更新于${date(v.updatedAt)}</p>` : ""}</details><div class="play-item-actions"><button class="button small light" type="button" data-play-edit="${esc(v.id)}" ${state.working ? "disabled" : ""}>编辑草稿</button><button class="button small" type="button" data-play-publish="${esc(v.id)}" ${state.working ? "disabled" : ""}>审核并发布</button><button class="button small secondary" type="button" data-play-disable="${esc(v.id)}" ${state.working || !v.enabled ? "disabled" : ""}>停用</button></div></article>`).join("") || '<div class="empty">没有符合条件的题目。可调整筛选，或新增原创题目。</div>'}</div></section>`;
}
function reviewDialog() {
  const q = state.review;
  return `<dialog id="play-publish-dialog" aria-labelledby="play-review-title"><form id="play-publish-form"><h2 id="play-review-title">核对后发布</h2><p>发布替换后续新题单使用的版本，已创建题单保留原快照。</p>${q ? `<input type="hidden" name="questionId" value="${esc(q.id)}"><input type="hidden" name="version" value="${q.version}"><div class="play-review-preview"><strong>${esc(q.prompt)}</strong><p>正确答案：${letters[q.correctIndex]} · ${esc(q.options[q.correctIndex])}</p><p>${esc(q.explanation)}</p><small>来源：${esc(q.sourceNote)}</small></div>` : ""}<label class="play-review-check"><input type="checkbox" name="rightsConfirmed" required>已核实内容为原创或具有适用授权</label><label class="play-review-check"><input type="checkbox" name="answerChecked" required>已逐项核对题目、答案与解析</label><label class="field-label">审核依据<textarea class="field" name="reviewNote" minlength="2" maxlength="200" rows="2" required placeholder="记录核对依据或来源，不填空泛承诺"></textarea></label><div class="play-form-actions"><button class="button small" type="submit">确认发布</button><button class="button small light" type="button" data-play-review-cancel>返回检查</button></div></form></dialog>`;
}
export function playAdminView(data) {
  const s = data.playSummary || {},
    stats = [
      [s.publishedCount || 0, "可用于新题单的题目"],
      [s.quizCompleted || 0, "已完成每日题单"],
      [s.answers || 0, "实际提交答案"],
      [s.gameCompleted || 0, "已结束益智场次"],
    ];
  return `<section id="play-admin" class="section" aria-busy="${state.working}" aria-labelledby="play-admin-title"><div class="row"><div><div class="eyebrow">PLAY AND CONTENT</div><h2 id="play-admin-title">趣玩内容与审核</h2></div><span class="pill">${s.enabled ? "内部体验开放" : "用户端已关闭"}</span></div><p class="caption">${esc(s.notice || "统计来自实际题单、提交与游戏记录；不计为真实广告曝光或收入。")}</p><div class="admin-stats">${stats.map(([n, t]) => `<div class="stat"><strong>${Number(n).toLocaleString()}</strong><small>${t}</small></div>`).join("")}</div><p class="caption">题目${s.questionCount || 0}条，其中待发布草稿${s.draftCount || 0}条；实际创建题单${s.quizSessions || 0}份、益智场次${s.gameSessions || 0}场。已结束场次含主动结束，不等于通关；没有虚构在线人数或收益。</p>${state.error ? `<div class="error" role="alert">${esc(state.error)}<br>操作未确认成功，编辑内容仍保留。刷新题库并重新载入服务器版本后再处理。</div>` : ""}<div class="play-admin-grid">${editor(data)}${list(data)}</div>${reviewDialog()}</section>`;
}
function repaint() {
  if (!context || !el("#play-admin")) return;
  el("#play-admin").outerHTML = playAdminView(context.getData());
}
function capture() {
  const f = el("#play-question-form");
  if (!f) return;
  const d = Object.fromEntries(new FormData(f));
  state.draft = {
    questionId: d.questionId,
    version: d.version,
    category: d.category,
    prompt: d.prompt,
    options: letters.map((_, i) => d["option" + i]),
    correctIndex: Number(d.correctIndex),
    explanation: d.explanation,
    sourceNote: d.sourceNote,
  };
}
async function act(fn) {
  if (state.working) return;
  state.working = true;
  el("#play-admin")?.setAttribute("aria-busy", "true");
  state.error = "";
  try {
    await context.run(async () => {
      try {
        await fn();
      } catch (e) {
        state.error = e.message || "操作未完成";
        throw e;
      }
    });
  } finally {
    state.working = false;
    repaint();
  }
}
function loadQuestion(id) {
  const q = question(context.getData(), id);
  if (!q) return;
  if (
    state.dirty &&
    !window.confirm("将载入服务器版本，当前未保存的编辑会被替换。继续？")
  )
    return;
  state.draft = copyQuestion(q);
  state.dirty = false;
  state.error = "";
  repaint();
  el("#play-question-form [name=prompt]")?.focus();
  el(".play-editor")?.scrollIntoView({ block: "start", behavior: "smooth" });
}
export function bindPlayAdmin(options) {
  context = options;
  document.addEventListener("input", (e) => {
    if (!e.target.closest("#play-question-form")) return;
    capture();
    state.dirty = true;
    const label = el(".play-editor-status");
    if (label) label.textContent = "尚未保存";
  });
  document.addEventListener("change", (e) => {
    if (e.target.closest("#play-question-form")) {
      capture();
      state.dirty = true;
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "play-question-form") {
      e.preventDefault();
      capture();
      const { questionId, version, ...body } = state.draft;
      return act(async () => {
        await context.api(
          "/play/questions" + (questionId ? "/" + questionId : ""),
          questionId ? "PUT" : "POST",
          { ...body, ...(questionId ? { version: Number(version) } : {}) },
        );
        state.queryResult = null;
        state.draft = fresh();
        state.dirty = false;
        toast("草稿已保存；审核发布后用于新题单");
      });
    }
    if (e.target.id === "play-question-filter") {
      e.preventDefault();
      state.filters = Object.fromEntries(new FormData(e.target));
      return act(async () => {
        state.queryResult = await context.api(
          "/play/questions?" + new URLSearchParams(state.filters),
        );
      });
    }
    if (e.target.id === "play-publish-form") {
      e.preventDefault();
      const raw = Object.fromEntries(new FormData(e.target));
      return act(async () => {
        const published = await context.api(
          "/play/questions/" + raw.questionId + "/publish",
          "POST",
          {
            version: Number(raw.version),
            reviewNote: raw.reviewNote,
            rightsConfirmed: raw.rightsConfirmed === "on",
            answerChecked: raw.answerChecked === "on",
          },
        );
        if (
          state.draft.questionId === raw.questionId &&
          Number(state.draft.version) === Number(raw.version)
        )
          state.draft.version = published.version;
        el("#play-publish-dialog")?.close();
        state.review = null;
        state.queryResult = null;
        toast("审核已记录，新题单使用此发布版");
      });
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || state.working) return;
    if (b.hasAttribute("data-play-new")) {
      if (state.dirty && !window.confirm("清空当前未保存的题目？")) return;
      state.draft = fresh();
      state.dirty = false;
      state.error = "";
      repaint();
    }
    if (b.dataset.playEdit) loadQuestion(b.dataset.playEdit);
    if (b.dataset.playReload) loadQuestion(b.dataset.playReload);
    if (b.hasAttribute("data-play-refresh"))
      return act(async () => {
        state.queryResult = await context.api(
          "/play/questions?" + new URLSearchParams(state.filters),
        );
      });
    if (b.dataset.playPublish) {
      const q = question(context.getData(), b.dataset.playPublish);
      if (!q) return;
      capture();
      state.review = q;
      repaint();
      el("#play-publish-dialog").showModal();
    }
    if (b.hasAttribute("data-play-review-cancel")) {
      el("#play-publish-dialog").close();
      state.review = null;
    }
    if (b.dataset.playDisable) {
      const q = question(context.getData(), b.dataset.playDisable);
      if (!q) return;
      if (
        window.confirm(
          "停用后新题单不再选取此题，已经创建的题单仍按原快照完成。确认停用？",
        )
      )
        return act(async () => {
          const disabled = await context.api(
            "/play/questions/" + q.id + "/disable",
            "POST",
            {
              version: q.version,
            },
          );
          if (
            state.draft.questionId === q.id &&
            Number(state.draft.version) === q.version
          )
            state.draft.version = disabled.version;
          state.queryResult = null;
          toast("题目已停用，原题单快照保留");
        });
    }
  });
}
