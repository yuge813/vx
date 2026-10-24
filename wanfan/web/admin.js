import { $, esc, icon, stamp, notify } from "./shared.js";
let token = "",
  data = null,
  busy = false;
async function api(path, method = "GET", body) {
  const r = await fetch("/api/admin" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const v = await r.json();
  if (!r.ok) {
    if (r.status === 401) logout();
    throw new Error(v.error?.message || "请求失败");
  }
  return v;
}
function logout() {
  token = "";
  data = null;
  $("#dashboard").innerHTML = "";
  $("#dashboard").hidden = true;
  $("#login").hidden = false;
  $("#logout").hidden = true;
  $("#admin-token").value = "";
}
async function load() {
  data = await api("/overview");
  render();
}
function render() {
  const d = data;
  $("#login").hidden = true;
  $("#logout").hidden = false;
  $("#dashboard").hidden = false;
  $("#dashboard").innerHTML =
    `<div class="page-top"><div><div class="eyebrow">REAL USAGE, SMALL STEPS</div><h1>先让一顿饭，真正发生。</h1><div class="muted">${d.today} · 北京时间业务日期 · ${d.totalUsers} 个当前账户</div></div><button class="button small light" data-refresh>刷新数据</button></div><div class="admin-stats">${[
      [d.stats.activeUsers, "今日活跃用户"],
      [d.stats.planners, "今日选餐用户"],
      [d.stats.cooks, "今日完成用户"],
      [d.stats.checkins, "今日签到用户"],
    ]
      .map(([n, s]) => `<div class="stat"><b>${n}</b><small>${s}</small></div>`)
      .join(
        "",
      )}</div><div class="admin-grid"><section class="card"><h2>先看核心复用，再看广告</h2><p class="muted">回访按目标日访问事件计算，基于对应注册日期的当前账户队列。样本为空时显示无数据；仅为内部原型统计。</p>${d.cohorts.map((c) => `<div class="row operation-row"><span>${c.days === 1 ? "次日" : "第7日"}回访 · ${c.cohortDay} 注册</span><span>${c.rate === null ? "无数据" : Math.round(c.rate * 100) + "%"} <small>(${c.retained}/${c.cohortSize})</small></span></div>`).join("")}<p class="caption">删除账户会移除相应事件，历史样本随之变化。不能把签到率直接当作做饭留存。</p></section><section class="card side-note"><div class="mini-art">${icon("leaf")}</div><h2>能力边界，保持透明。</h2><p>真实广告：关闭<br>广告奖励用途：未核实<br>现金、实物兑换：关闭<br>支付：未接入<br>测试权益：开发模式管理员授予<br>内容：原创开发稿，待人工校对</p></section></div><section class="card"><div class="row"><h2>用户与内部体验权益</h2><span class="pill">每日最多100位 · 不来自广告</span></div><div class="table-scroll"><table><thead><tr><th>用户编号</th><th>注册时间</th><th>完成餐数 / 签到</th><th>周计划权益</th><th>操作</th></tr></thead><tbody>${d.users.map((u) => `<tr><td title="${u.id}">${u.id.slice(0, 8)}</td><td>${stamp(u.createdAt)}</td><td>${u.mealsCompleted} / ${u.streak}天</td><td>${u.entitlement.active ? "内部体验有效" : "无有效权益"}</td><td><button class="button small light" data-grant="${u.id}" ${d.config.mode !== "development" ? "disabled" : ""}>授予24小时测试权益</button></td></tr>`).join("") || '<tr><td colspan="5">暂无用户</td></tr>'}</tbody></table></div></section><section class="card"><h2>菜谱内容管理</h2><p class="caption">可停用有问题的菜谱，编辑及校对在源码catalog.mjs中进行。启用不代表食品安全审核或微信许可。</p><div class="table-scroll"><table><thead><tr><th>原创菜谱</th><th>时间 / 类型</th><th>内容状态</th><th>展示</th><th>操作</th></tr></thead><tbody>${d.recipes.map((r) => `<tr><td>${esc(r.title)}</td><td>${r.minutes}分钟 / ${r.vegetarian ? "蛋奶素食" : "荤菜"}</td><td>待人工烹饪校对</td><td>${r.active ? "内部展示" : "已停用"}</td><td><button class="button small outline" data-recipe="${r.id}" data-active="${!r.active}">${r.active ? "停用" : "重新启用"}</button></td></tr>`).join("")}</tbody></table></div></section><section class="card"><h2>反馈与回复</h2>${d.feedback.length ? d.feedback.map((f) => `<div class="operation-row"><div class="row"><span>${f.user_id.slice(0, 8)} · ${stamp(f.created_at)}</span><span class="pill">${f.state === "resolved" ? "已回复" : "待处理"}</span></div><p class="admin-text">${esc(f.message)}</p>${f.reply ? `<p class="muted">回复：${esc(f.reply)}</p>` : ""}<button class="button small light" data-reply="${f.id}">回复反馈</button></div>`).join("") : '<p class="muted">暂无反馈</p>'}</section><section class="card"><h2>操作审计</h2>${d.audit.length ? d.audit.map((a) => `<div class="operation-row"><div class="row"><span>${esc(a.action)}</span><small>${stamp(a.created_at)}</small></div><small>${esc(a.reference)} · ${esc(a.detail)}</small></div>`).join("") : '<p class="muted">暂无操作</p>'}</section>`;
}
async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("#dashboard button").forEach((b) => {
    b.disabled = true;
  });
  try {
    await fn();
    await load();
  } catch (e) {
    notify(e.message);
    if (data) render();
  } finally {
    busy = false;
  }
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  token = $("#admin-token").value.trim();
  try {
    await load();
    $("#admin-token").value = "";
  } catch (e) {
    $("#login-error").textContent = e.message;
    token = "";
  } finally {
    busy = false;
  }
});
$("#logout").addEventListener("click", logout);
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled || busy) return;
  if (b.hasAttribute("data-refresh")) run(async () => {});
  if (b.dataset.grant)
    run(async () => {
      await api("/users/" + b.dataset.grant + "/grant", "POST", {});
      notify("内部测试权益已授予，不代表广告观看");
    });
  if (b.dataset.recipe)
    run(() =>
      api("/recipes/" + b.dataset.recipe, "PUT", {
        active: b.dataset.active === "true",
      }),
    );
  if (b.dataset.reply) {
    const reply = window.prompt("填写回复（2—1000字）");
    if (reply?.trim())
      run(() =>
        api("/feedback/" + b.dataset.reply + "/reply", "POST", { reply }),
      );
  }
});
