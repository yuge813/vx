import { $, esc, icon, stamp, notify } from "./shared.js";
const pages = [
  ["today", "bowl", "今日晚餐"],
  ["pantry", "fridge", "食材冰箱"],
  ["shopping", "bag", "采购清单"],
  ["journal", "journal", "我的日常"],
];
const state = {
  page: "today",
  data: null,
  journal: null,
  week: null,
  busy: false,
  pantryDraft: null,
};
let token = localStorage.getItem("wanfan.token") || "",
  currentRecipe = null;
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await r.json();
  if (!r.ok) {
    const e = new Error(result.error?.message || "请求失败");
    e.status = r.status;
    throw e;
  }
  return result;
}
async function init() {
  const config = await api("/config");
  if (token)
    try {
      await api("/me");
    } catch (e) {
      if (e.status !== 401) throw e;
      token = "";
      localStorage.removeItem("wanfan.token");
    }
  if (!token) {
    if (config.mode !== "development")
      throw new Error(
        "浏览器登录仅供内部开发，正式微信登录请使用已配置的小程序。",
      );
    let installationId = localStorage.getItem("wanfan.installation");
    if (!installationId) {
      installationId = crypto.randomUUID();
      localStorage.setItem("wanfan.installation", installationId);
    }
    const login = await api("/auth/demo", "POST", { installationId });
    token = login.token;
    localStorage.setItem("wanfan.token", token);
  }
  await refresh();
  render();
}
async function refresh() {
  [state.data, state.journal, state.week] = await Promise.all([
    api("/dashboard"),
    api("/journal"),
    api("/week"),
  ]);
}
function header(kicker, title, description) {
  const date = new Date(state.data.user.serverTime).toLocaleDateString(
    "zh-CN",
    {
      timeZone: "Asia/Shanghai",
      month: "long",
      day: "numeric",
      weekday: "long",
    },
  );
  return `<header class="page-top"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><div class="muted">${description}</div></div><span class="date">${date}</span></header>`;
}
function meta(r) {
  return `<div class="meta"><span>${icon("clock")}${r.minutes}分钟</span><span>${icon("people")}${r.servings}人份</span><span>${icon("leaf")}${r.vegetarian ? "蛋奶素食" : "家常荤菜"}</span></div>`;
}
function empty(symbol, title, body, button = "") {
  return `<div class="empty">${icon(symbol)}<strong>${title}</strong><div>${body}</div>${button}</div>`;
}
function planRows() {
  const plans = state.data.plans;
  return plans.length
    ? plans
        .map(
          (p) =>
            `<div class="row plan-row"><img src="/assets/${p.recipe.art}.svg" alt="${esc(p.recipe.title)}原创插画"><div class="plan-info"><h3>${esc(p.recipe.title)}</h3><small>${p.servings}人份 · ${p.state === "completed" ? "今天已完成" : "今晚待做"}</small></div><div class="plan-actions"><button class="icon-button" data-recipe="${p.recipe_id}" aria-label="查看做法">${icon("journal")}</button>${p.state === "planned" ? `<button class="icon-button" data-complete="${p.id}" aria-label="标记完成">${icon("check")}</button><button class="icon-button" data-remove-plan="${p.id}" aria-label="移除菜单">${icon("close")}</button>` : `<span class="icon-button done">${icon("check")}</span>`}</div></div>`,
        )
        .join("")
    : empty("bowl", "今晚吃什么？", "挑一道喜欢的菜，今晚就有了安排。");
}
function checkinCard() {
  const u = state.data.user;
  return `<section class="card"><div class="row"><h2>给日常留个印记</h2><span class="label-number">${u.streak}<small style="font:10px sans-serif"> 天</small></span></div><p class="muted">免费签到，每一天都算数。</p><div class="week">${u.week.map((d, i) => `<div class="week-day ${d.signed ? "signed" : ""} ${i === 6 ? "today" : ""}"><span>${d.signed ? icon("check") : String(d.date.slice(-2))}</span>${esc(d.label)}</div>`).join("")}</div><button class="button light full" data-action="checkin" ${u.signedToday ? "disabled" : ""}>${u.signedToday ? "今日已签到" : icon("check") + "签到，记下今天"}</button></section>`;
}
function weeklyCard() {
  const u = state.data.user;
  return `<section class="card side-note"><div class="row-on-mobile"><div class="mini-art">${icon("calendar")}</div><div><div class="eyebrow">A LITTLE MORE ORGANIZED</div><h2>把一周的晚饭，<br>也安排得从容一点。</h2></div></div><p>周计划助手可生成7天候选菜单与合计用料。免费每日选餐和采购清单始终可用。</p><button class="button outline full" data-action="week">${u.entitlement.active ? "使用内部体验权益" : state.week ? "查看已保存周计划" : "了解周计划助手"}${icon("arrow")}</button><div class="ad-disabled">${u.entitlement.active ? "管理员授予的内部体验，不来自广告" : "广告奖励用途未核实，观看入口关闭"}</div></section>`;
}
function today() {
  const { user: u, recommendations: rs, pantry } = state.data;
  const r = rs[0],
    prefs = u.prefs;
  return (
    header(
      "A GOOD DINNER, A BETTER EVERYDAY",
      "今天这顿，安排好了。",
      "少一点纠结，多一点家常的好滋味。",
    ) +
    `<form id="preferences-form" class="toolbar"><div class="filters"><label>${icon("people")}<select name="servings" aria-label="用餐人数">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === prefs.servings ? "selected" : ""}>${n}人吃饭</option>`).join("")}</select></label><label>${icon("clock")}<select name="maxMinutes" aria-label="可用时间">${[15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${n === prefs.maxMinutes ? "selected" : ""}>${n}分钟内</option>`).join("")}</select></label><label><input type="checkbox" name="vegetarian" ${prefs.vegetarian ? "checked" : ""}>蛋奶素食</label></div><button class="button small light" type="submit">更新偏好</button></form><div class="grid"><div><div class="section"><span class="section-title">今晚，试试这道</span><button class="link-button" data-action="rotate">${icon("refresh")}换一组</button></div>${r ? `<section class="card feature"><div class="feature-art"><div class="row topline"><span class="pill">${icon("leaf")}${pantry.length ? "参考已记录的食材" : "按用时与口味推荐"}</span><span class="prototype">内部原型</span></div><img src="/assets/${r.art}.svg" alt="${esc(r.title)}原创餐盘插画"><div class="feature-stamp">SIMPLE<b>HOME</b>COOKING</div></div><div class="feature-body"><div class="subheading">一顿家常饭的提案</div><h2>${esc(r.title)}</h2><div class="muted">${esc(r.subtitle)}</div>${meta(r)}<div class="row"><span class="caption">还需准备 ${r.ingredients.filter((x) => x.missing > 0).length} 种食材</span><button class="link-button" data-recipe="${r.id}">完整做法 ${icon("arrow")}</button></div><button class="button full" data-plan="${r.id}" ${state.data.plans.some((p) => p.recipe_id === r.id) ? "disabled" : ""}>${state.data.plans.some((p) => p.recipe_id === r.id) ? "已在今晚菜单中" : "就吃这道，加入今晚菜单"}${icon("arrow")}</button></div></section>` : empty("bowl", "当前偏好下没有菜谱", "试着增加准备时间，或调整蛋奶素食选项。")}<div class="section"><span class="section-title">也可以换个口味</span><span class="caption">做法全部免费查看</span></div><div class="alternatives">${
      rs
        .slice(1)
        .map(
          (a) =>
            `<button class="card recipe-small" data-recipe="${a.id}" aria-label="查看${esc(a.title)}做法"><img src="/assets/${a.art}.svg" alt=""><div class="recipe-small-body"><h3>${esc(a.title)}</h3>${meta(a)}</div></button>`,
        )
        .join("") || '<p class="caption">这个条件下暂时没有更多备选菜谱。</p>'
    }</div><p class="caption">菜谱为原创开发稿，待人工烹饪校对；时间为估算，请确认食材新鲜并充分煮熟。</p></div><aside><section class="card"><div class="row"><h2>我的今晚菜单</h2><span class="pill">${state.data.plans.length} 道</span></div>${planRows()}${state.data.plans.some((p) => p.state === "planned") ? `<button class="button light full" data-nav="shopping">查看缺料清单 ${icon("arrow")}</button>` : ""}</section><section class="card"><div class="row"><h2>冰箱里，还有这些</h2><button class="link-button" data-nav="pantry">管理 ${icon("arrow")}</button></div>${
      pantry.length
        ? pantry
            .slice(0, 3)
            .map(
              (p) =>
                `<div class="row plan-row"><span class="pill ${p.expired ? "warm" : ""}">${esc(p.name)}</span><span class="caption">${p.expired ? "已过自设日期" : p.amount + " " + p.unit}</span></div>`,
            )
            .join("")
        : '<p class="muted">添加手头食材，推荐会更贴合你的厨房。</p>'
    }<button class="button outline full" data-nav="pantry">${icon("plus")}录入已有食材</button></section>${checkinCard()}<div class="quote">“好好吃饭，<br>就是认真生活的小事。”<small>THE EVERYDAY TABLE</small></div></aside></div>${weeklyCard()}`
  );
}
function pantry() {
  const c = state.data.config,
    items = state.data.pantry,
    d = state.pantryDraft || {};
  return (
    header(
      "A LITTLE ORDER IN YOUR KITCHEN",
      "打开冰箱，心里有数。",
      "记下手头的食材，让下一顿饭更好安排。",
    ) +
    `<div class="grid"><section><div class="section"><span class="section-title">已记录 ${items.length} 种食材</span><span class="caption">日期由你设定</span></div><div class="inventory-list">${items.map((p) => `<article class="ingredient-card"><div class="ingredient-symbol">${esc(p.name.slice(0, 1))}</div><div class="plan-info"><h3>${esc(p.name)} · ${p.amount}${p.unit}</h3><small class="${p.expired ? "expired" : ""}">${p.expires ? (p.expired ? "已过自设日期 · " : "自设日期 · ") + p.expires : "未设日期"}</small></div><div><button class="icon-button" data-edit-pantry="${p.id}" aria-label="修改${esc(p.name)}">${icon("journal")}</button><button class="icon-button" data-delete-pantry="${p.id}" aria-label="移除${esc(p.name)}">${icon("trash")}</button></div></article>`).join("")}</div>${!items.length ? empty("fridge", "冰箱记录还是空的", "从一颗番茄、一盒鸡蛋开始；不需要拍照或授权相册。") : ""}<div class="notice">日期是你输入的提醒信息，不是食品安全判断。已过日期的食材不计入可用库存，请自行检查实际状态。</div></section><aside><section class="card"><h2>${d.ingredientId ? "修改已有记录" : "加一点厨房的底气"}</h2><form id="pantry-form"><label class="field-label" for="ingredient-id">食材</label><select class="field" id="ingredient-id" name="ingredientId">${c.ingredients.map((i) => `<option value="${i.id}" data-unit="${i.unit}" ${d.ingredientId === i.id ? "selected" : ""}>${esc(i.name)}（${i.unit}）</option>`).join("")}</select><label class="field-label" for="ingredient-amount">数量 · <span id="ingredient-unit">${c.ingredients.find((i) => i.id === (d.ingredientId || "tomato")).unit}</span></label><input class="field" id="ingredient-amount" name="amount" type="number" min="0.01" max="100000" step="0.01" value="${d.amount ?? 2}" required><label class="field-label" for="ingredient-expires">自设到期日（可不填）</label><input class="field" id="ingredient-expires" name="expires" type="date" value="${esc(d.expires || "")}"><button class="button full" type="submit">${icon("plus")}保存食材记录</button></form><p class="caption">保存会更新该食材的数量。完成菜单时会按配方扣减已记录且未过日期的库存。</p></section>${weeklyCard()}</aside></div>`
  );
}
function shopping() {
  const list = state.data.shopping,
    checked = list.filter((x) => x.checked).length;
  return (
    header(
      "LESS GUESSING, A BETTER SHOPPING LIST",
      "少买一点，刚好够吃。",
      "按今天待做的菜单计算，扣除你记录的未过日期库存。",
    ) +
    `<div class="grid"><section class="card"><div class="row"><h2>今天的缺料清单</h2><span class="pill">${checked} / ${list.length} 已勾选</span></div><div class="progress"><span style="width:${list.length ? (checked / list.length) * 100 : 0}%"></span></div>${list.length ? list.map((p) => `<label class="shopping-item ${p.checked ? "checked" : ""}"><input type="checkbox" data-purchase="${p.id}" ${p.checked ? "checked" : ""}><span class="name">${esc(p.name)}</span><span class="quantity">${p.missing}<small>${p.unit}</small></span></label>`).join("") : empty("bag", state.data.plans.some((p) => p.state === "planned") ? "记录的食材已经够用" : "先决定今晚吃什么", state.data.plans.some((p) => p.state === "planned") ? "请以实际库存为准，开心准备一顿饭。" : "选好菜谱后，这里会自动整理缺料。", '<button class="button light" data-nav="today">去选今晚菜单</button>')}<div class="notice">勾选仅记录采购进度，不自动增加冰箱库存。实际买到后，可在食材冰箱中更新数量；用料增加时会重新提示采购。</div></section><aside><section class="card"><h2>今晚的菜单依据</h2>${planRows()}</section><section class="card side-note"><div class="mini-art">${icon("leaf")}</div><h2>买刚好需要的，<br>把食材用在当下。</h2><p>清单来自配方估算，实际规格和用量请按自己的习惯调整。没有自动下单或支付。</p></section></aside></div>`
  );
}
function journal() {
  const j = state.journal,
    u = state.data.user;
  return (
    header(
      "MAKE ROOM FOR YOUR EVERYDAY",
      "吃过的饭，留下的日常。",
      "一顿顿认真做的饭，都是生活的小小成果。",
    ) +
    `<div class="stats">${[
      [u.mealsCompleted, "累计完成 / 餐"],
      [u.streak, "连续签到 / 天"],
      [j.favorites.length, "收藏菜谱 / 道"],
    ]
      .map(([n, s]) => `<div class="stat"><b>${n}</b><small>${s}</small></div>`)
      .join(
        "",
      )}</div><div class="grid"><section><section class="card"><h2>我的餐桌记录</h2>${j.history.length ? j.history.map((p) => `<div class="history-row"><img src="/assets/${p.art}.svg" alt=""><div class="plan-info"><h3>${esc(p.title)}</h3><div class="muted">${p.date} · ${p.servings}人份 · 已完成</div></div><button class="icon-button" data-recipe="${p.recipe_id}" aria-label="查看做法">${icon("chevron")}</button></div>`).join("") : empty("journal", "还没有完成记录", "加入今晚菜单后，做完一餐再点“完成”，记录会真实保留。")}</section><section class="card"><h2>想再做一次的味道</h2>${j.favorites.length ? j.favorites.map((r) => `<div class="history-row"><img src="/assets/${r.art}.svg" alt=""><div class="plan-info"><h3>${esc(r.title)}</h3><div class="muted">${r.minutes}分钟 · 收藏菜谱</div></div><button class="icon-button" data-recipe="${r.id}" aria-label="查看收藏">${icon("arrow")}</button></div>`).join("") : empty("heart", "收藏一份熟悉的好味道", "菜谱详情可收藏，随时免费查看。")}</section>${j.grants.length ? `<section class="card"><h2>内部体验权益记录</h2>${j.grants.map((g) => `<div class="operation-row">周计划助手 · 管理员内部授予<small style="display:block">有效至 ${stamp(g.expires_at)} · 非广告奖励，不可兑换</small></div>`).join("")}</section>` : ""}<section class="card"><h2>我的反馈</h2>${j.feedback.length ? j.feedback.map((f) => `<div class="operation-row">${esc(f.message)}<small style="display:block">${f.state === "resolved" ? "已回复" : "待处理"} · ${stamp(f.created_at)}</small>${f.reply ? `<p>回复：${esc(f.reply)}</p>` : ""}</div>`).join("") : '<p class="muted">还没有反馈。你的具体问题可以直接提交给内部运营后台。</p>'}<button class="button light" data-action="feedback">${icon("note")}提交反馈</button></section></section><aside>${checkinCard()}${weeklyCard()}<section class="card"><button class="profile-link" data-action="privacy">隐私与数据 ${icon("chevron")}</button><button class="profile-link" data-action="capabilities">广告与奖励状态 ${icon("chevron")}</button><button class="profile-link" data-action="delete-account">删除我的账户与记录 ${icon("chevron")}</button><a class="profile-link" href="/admin">内容与运营后台 ${icon("arrow")}</a><p class="caption">内部编号 ${u.id.slice(0, 8)}<br>正式企业客服及隐私主体仍待配置。</p></section></aside></div>`
  );
}
function render() {
  if (!state.data) return;
  $("#navigation").innerHTML = pages
    .map(
      ([page, symbol, label]) =>
        `<button data-nav="${page}" class="${state.page === page ? "active" : ""}" aria-current="${state.page === page ? "page" : "false"}">${icon(symbol)}<span>${label}</span></button>`,
    )
    .join("");
  $("#app").innerHTML =
    { today, pantry, shopping, journal }[state.page]() +
    '<footer class="footer">晚饭有谱 · 好好吃饭，慢慢生活</footer>';
  $("#app").setAttribute("aria-busy", "false");
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  $("#app").setAttribute("aria-busy", "true");
  document.querySelectorAll("#app button").forEach((b) => {
    b.disabled = true;
  });
  try {
    await fn();
    await refresh();
  } catch (e) {
    notify(e.message || "连接失败，请重试；已保存的记录不会因此清除。");
  } finally {
    state.busy = false;
    render();
  }
}
async function openRecipe(recipeId) {
  const r = await api("/recipes/" + recipeId);
  currentRecipe = r;
  const planned = state.data.plans.some((p) => p.recipe_id === r.id);
  $("#recipe-content").innerHTML =
    `<div class="dialog-head row"><span class="subheading">RECIPE / 家常的好味道</span><button class="icon-button" data-close="recipe-dialog" aria-label="关闭菜谱">${icon("close")}</button></div><div class="recipe-dialog-art"><img src="/assets/${r.art}.svg" alt="${esc(r.title)}原创插画"></div><div class="dialog-body"><div class="row"><h2 id="recipe-title">${esc(r.title)}</h2><button class="icon-button" data-favorite="${r.id}" aria-label="${r.favorite ? "取消收藏" : "收藏"}">${icon("heart", r.favorite ? 'style="fill:#dbe5ce"' : "")}</button></div><p class="muted">${esc(r.subtitle)}</p>${meta(r)}<div class="section"><strong>准备这些就好</strong><span class="caption">按${r.servings}人份换算</span></div><div class="ingredients">${r.ingredients.map((i) => `<div class="ingredient-line"><span>${esc(i.name)}<small style="display:block">${i.missing ? "还缺 " + i.missing + i.unit : "记录库存够用"}</small></span><span>${i.amount}${i.unit}</span></div>`).join("")}</div><h3>一步步，慢慢来</h3><ol class="steps">${r.steps.map((s, i) => `<li><b>${String(i + 1).padStart(2, "0")}</b><span>${esc(s)}</span></li>`).join("")}</ol><div class="notice">${esc(r.tips)}</div><div class="caption">${esc(r.source)} · ${esc(r.reviewStatus)}。留意个人过敏原及调味料配料。</div><button class="button full" data-plan="${r.id}" ${planned ? "disabled" : ""}>${planned ? "已在今晚菜单中" : "就吃这道，加入今晚菜单"}${icon("arrow")}</button></div>`;
  if (!$("#recipe-dialog").open) $("#recipe-dialog").showModal();
}
async function showWeek() {
  currentRecipe = null;
  state.data.user = await api("/me");
  state.week = await api("/week");
  const u = state.data.user,
    w = state.week;
  $("#recipe-content").innerHTML =
    `<div class="dialog-head row"><h2 id="recipe-title">周计划助手</h2><button class="icon-button" data-close="recipe-dialog" aria-label="关闭">${icon("close")}</button></div><div class="dialog-body"><div class="mini-art">${icon("calendar")}</div><h2>提前想好，一周从容。</h2><p class="muted">生成7天候选晚餐和合计用料。每日选餐、完整做法与采购清单免费使用。</p><div class="notice">${u.entitlement.active ? "当前为管理员授予的24小时内部体验，不来自真实广告。" : "当前没有广告观看入口。奖励用途及平台权限未核实，商业能力保持关闭。"}</div>${u.entitlement.active ? '<button class="button full" data-action="generate-week">生成7天候选安排</button>' : '<button class="button full" disabled>尚未开放领取</button>'}${w ? `<section class="week-result"><h3>已保存的安排</h3>${w.days.map((d) => `<div class="week-row"><time>${d.date.slice(5)}</time><strong>${esc(d.title)}</strong><span>${d.minutes}分钟</span></div>`).join("")}<div class="notice">${esc(w.note)}</div><h3>一周合计用料</h3><div class="ingredients">${w.ingredients.map((i) => `<div class="ingredient-line"><span>${esc(i.name)}</span><span>${i.amount}${i.unit}</span></div>`).join("")}</div></section>` : '<p class="caption">内部测试可由管理员授予体验权益，领取与有效期会留存审计。</p>'}</div>`;
  if (!$("#recipe-dialog").open) $("#recipe-dialog").showModal();
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.close) {
    $("#" + b.dataset.close).close();
    return;
  }
  if (state.busy) return;
  try {
    if (b.dataset.nav) {
      state.page = b.dataset.nav;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (b.dataset.recipe) {
      await openRecipe(b.dataset.recipe);
      return;
    }
    if (b.dataset.plan) {
      await run(async () => {
        await api("/plans", "POST", {
          recipeId: b.dataset.plan,
          servings: state.data.user.prefs.servings,
        });
        notify("已加入今晚菜单，缺料清单同步更新");
        $("#recipe-dialog").close();
      });
      return;
    }
    if (b.dataset.complete) {
      if (
        !window.confirm(
          "确认已完成这顿饭？将按配方扣减已记录且未过日期的库存，不足部分按0处理。",
        )
      )
        return;
      await run(async () => {
        await api("/plans/" + b.dataset.complete + "/complete", "POST", {});
        notify("这一餐，记下了。");
      });
      return;
    }
    if (b.dataset.removePlan) {
      await run(() => api("/plans/" + b.dataset.removePlan, "DELETE"));
      return;
    }
    if (b.dataset.favorite) {
      await run(async () => {
        await api("/recipes/" + b.dataset.favorite + "/favorite", "PUT", {
          favorite: !currentRecipe.favorite,
        });
        await openRecipe(b.dataset.favorite);
      });
      return;
    }
    if (b.dataset.editPantry) {
      const p = state.data.pantry.find((p) => p.id === b.dataset.editPantry);
      state.pantryDraft = {
        ingredientId: p.id,
        amount: p.amount,
        expires: p.expires,
      };
      render();
      $("#ingredient-amount").focus();
      return;
    }
    if (b.dataset.deletePantry) {
      await run(() => api("/pantry/" + b.dataset.deletePantry, "DELETE"));
      return;
    }
    const a = b.dataset.action;
    if (a === "rotate")
      await run(() => api("/recommendations/rotate", "POST", {}));
    if (a === "checkin")
      await run(async () => {
        await api("/checkin", "POST", {});
        notify("今天的日常，已经记下。");
      });
    if (a === "week") await showWeek();
    if (a === "generate-week")
      await run(async () => {
        state.week = await api("/week/generate", "POST", {});
        await showWeek();
      });
    if (a === "feedback") {
      $("#text-title").textContent = "告诉我们哪里需要改进";
      $("#text-description").textContent =
        "反馈将保存到内部运营后台，可在我的日常查看回复。正式企业客服尚待配置。";
      $("#text-value").value = "";
      $("#text-dialog").showModal();
    }
    if (a === "privacy")
      window.alert(
        "内部原型记录开发安装标识、会话、用餐偏好、食材、菜单、签到和反馈。只采集必要操作事件用于本机样本分析，不读取通讯录、位置、相册或剪贴板。删除账户会移除相关个人记录。正式发布前需配置运营主体、保留期限、企业客服和经核实的隐私指引。",
      );
    if (a === "capabilities")
      window.alert(
        "真实广告：关闭；广告奖励用途：未核实；现金及实物兑换：关闭；微信支付：未接入。周计划测试权益只由管理员内部授予，不可兑换。",
      );
    if (a === "delete-account") {
      if (
        window.prompt(
          "这会删除食材、菜单、签到、收藏与反馈。输入“删除”确认。",
        ) === "删除"
      ) {
        await api("/account", "DELETE", { confirm: "DELETE" });
        for (const k of ["wanfan.token", "wanfan.installation"])
          localStorage.removeItem(k);
        token = "";
        location.reload();
      }
    }
    if (a === "retry") await init();
  } catch (e) {
    notify(e.message || "连接失败，请重试");
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.purchase)
    run(() =>
      api("/shopping/" + el.dataset.purchase, "PUT", { checked: el.checked }),
    );
  if (el.id === "ingredient-id") {
    const i = state.data.config.ingredients.find((i) => i.id === el.value);
    $("#ingredient-unit").textContent = i.unit;
    $("#ingredient-amount").value = ["g", "ml"].includes(i.unit) ? 100 : 1;
  }
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.busy) return;
  const f = event.target,
    data = Object.fromEntries(new FormData(f));
  if (f.id === "preferences-form")
    run(() =>
      api("/preferences", "PUT", {
        servings: Number(data.servings),
        maxMinutes: Number(data.maxMinutes),
        vegetarian: !!data.vegetarian,
      }),
    );
  if (f.id === "pantry-form") {
    state.pantryDraft = {
      ingredientId: data.ingredientId,
      amount: Number(data.amount),
      expires: data.expires || null,
    };
    run(async () => {
      await api("/pantry", "PUT", state.pantryDraft);
      state.pantryDraft = null;
      notify("食材记录已更新");
    });
  }
  if (f.id === "text-form")
    run(async () => {
      await api("/feedback", "POST", { message: $("#text-value").value });
      $("#text-dialog").close();
      notify("反馈已保存，可在我的日常查看");
    });
});
init().catch((e) => {
  $("#app").innerHTML =
    `<div class="error">${esc(e.message)}<div><button class="button light" data-action="retry">重新连接</button></div></div>`;
});
