import { $, esc, date, toast } from "./shared.js";
import { roomAdminView, bindRoomAdmin } from "./room-admin.js";
import { opsView, bindOps, renderOpsSearch } from "./ops-admin.js";
let token = "",
  data = null,
  busy = false;
const labels = {
  pending_review: "待审核",
  approved: "已审核",
  rejected: "已驳回",
  demo_paid: "模拟完成，未付款",
};
const fields = [
  ["dailyAdLimit", "每人每日总次数", 0, 100],
  ["dailyBudgetCoins", "每日金币预算", 0, 100000000],
  ["signinBase", "签到基础金币", 1, 10000],
  ["subsidyCoins", "每次任务补贴", 0, 10000],
  ["packetIncrement", "每轮叠包增量", 100, 10000],
  ["packetCap", "每池叠包上限", 1000, 100000],
  ["packetIntervalSeconds", "红包/宝箱间隔秒", 120, 86400],
  ["bagCooldownSeconds", "福袋冷却秒", 60, 86400],
  ["signinLimit", "每日签到次数", 0, 1],
  ["redpacketLimit", "每日红包次数", 0, 100],
  ["treasureLimit", "每日宝箱次数", 0, 100],
  ["bagLimit", "每日福袋次数", 0, 100],
  ["prize80Weight", "80金币概率%", 0, 100],
  ["prize120Weight", "120金币概率%", 0, 100],
  ["prize200Weight", "200金币概率%", 0, 100],
  ["prize500Weight", "500金币概率%", 0, 100],
  ["adPreviewEnabled", "开发广告位预览开关（0/1）", 0, 1],
  ["nativePreviewDelaySeconds", "信息流首次预览秒", 10, 300],
  ["nativePreviewIntervalSeconds", "信息流预览间隔秒", 60, 3600],
  ["bannerPreviewDelaySeconds", "横幅首次预览秒", 10, 300],
  ["bannerPreviewIntervalSeconds", "横幅预览间隔秒", 60, 3600],
  ["adPreviewDurationSeconds", "单次位置预览时长秒", 5, 30],
  ["adPreviewCloseCooldownSeconds", "关闭预览后的冷却秒", 60, 3600],
  ["adPreviewSessionLimit", "每会话预览上限", 0, 20],
  ["adPreviewDailyLimit", "本机本账户每日预览上限", 0, 100],
];
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
  sessionStorage.removeItem("yx.admin.search");
  sessionStorage.removeItem("yx.admin.detail");
  $("#dashboard").hidden = true;
  $("#dashboard").innerHTML = "";
  $("#login").hidden = false;
  $("#logout").hidden = true;
  $("#admin-token").value = "";
}
async function load() {
  const [overview, roomContent] = await Promise.all([
    api("/overview"),
    api("/room-content"),
  ]);
  const [report, reconciliation, closures] = await Promise.all([
    api("/report"),
    api("/reconciliation"),
    api("/closures"),
  ]);
  data = { ...overview, roomContent, report, reconciliation, closures };
  render();
}
function render() {
  const d = data,
    c = d.config;
  $("#dashboard").hidden = false;
  $("#login").hidden = true;
  $("#logout").hidden = false;
  $("#dashboard").innerHTML =
    `<div class="row section"><div><div class="eyebrow">REWARD RULES AND LEDGER</div><h1>奖励有规则，账务有依据。</h1><div class="muted">业务日期${d.budget.day} · 北京时间 · 规则版本v${c.version}</div></div><button class="button small light" data-refresh>刷新数据</button></div><div class="admin-stats">${[
      [d.stats.users, "开发账户"],
      [d.budget.spent, "今日已支出金币"],
      [d.budget.reserved, "今日预留金币"],
      [d.stats.frozen, "提现冻结金币"],
    ]
      .map(
        ([n, t]) =>
          `<div class="stat"><strong>${n.toLocaleString()}</strong><small>${t}</small></div>`,
      )
      .join(
        "",
      )}</div><div class="admin-grid"><section class="card"><h2>奖励、叠包与开发预览</h2><p class="caption">叠包参数影响新一轮；已有金额和任务不追减。四档概率之和必须100。广告秒数仅为开发预览参数，不启用真实广告、不计曝光收入；本机频次是体验限制。换算比例不在这里直接修改。</p><form id="settings-form">${fields.map(([k, t, min, max]) => `<label class="setting"><span>${t}</span><input class="field" name="${k}" type="number" min="${min}" max="${max}" step="1" value="${c[k]}" required></label>`).join("")}<button class="button full" type="submit">保存新版本规则</button></form></section><aside><section class="card"><h2>预算与叠包预留</h2><div class="balance" style="font-size:42px;color:#bd8350">${Math.max(0, c.dailyBudgetCoins - d.budget.spent - d.budget.reserved).toLocaleString()}</div><div class="caption">今日可新增承诺 / 总预算${c.dailyBudgetCoins.toLocaleString()}</div><div class="progress"><span style="width:${Math.min(100, ((d.budget.spent + d.budget.reserved) / Math.max(c.dailyBudgetCoins, 1)) * 100)}%"></span></div><p class="muted">跨日叠包预留合计：${d.packetReserves}金币<br>已绑定邀请关系：${d.referralStats.n}<br>兑换比例：${c.coinsPerYuan}金币演示换算1元</p><div class="notice">取消打开任务只释放该任务补贴，保留叠包金额及其预留。完成后基础和补贴分别支出。</div></section><section class="card"><h2>实际能力状态</h2><p class="caption">签到、红包、宝箱、福袋：仅开发模拟<br>真实广告：未接入<br>微信零钱转账：未接入<br>邀请现金返佣：关闭<br>风控：基础规则与人工审核，非商业设备反作弊</p></section><section class="card"><h2>今日任务分布</h2>${d.taskCounts.length ? d.taskCounts.map((r) => `<div class="activity-row"><span>${esc(r.kind)} / ${esc(r.state)}</span><strong>${r.n}</strong></div>`).join("") : '<p class="muted">暂无任务</p>'}</section></aside></div><section class="card"><div class="row"><h2>演示提现申请</h2><span class="pill">先冻结，再审核</span></div><div class="table-scroll"><table><thead><tr><th>订单 / 用户</th><th>金币 / 金额</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${d.withdrawals.map((o) => `<tr><td title="${o.id}">${o.id.slice(0, 8)}<div class="caption">${o.user_id.slice(0, 8)}</div></td><td>${o.coins} / ¥${(o.amount_fen / 100).toFixed(2)}</td><td>${labels[o.state]}${o.reason ? `<div class="caption">${esc(o.reason)}</div>` : ""}</td><td>${date(o.created_at)}</td><td>${o.state === "pending_review" ? `<button class="button small light" data-order="${o.id}" data-review="approve">通过</button><button class="button small danger" data-order="${o.id}" data-review="reject">驳回退回</button>` : o.state === "approved" ? `<button class="button small secondary" data-order="${o.id}" data-review="simulate_pay">模拟完成（不付款）</button>` : "—"}</td></tr>`).join("") || '<tr><td colspan="5">暂无申请</td></tr>'}</tbody></table></div></section><section class="card"><h2>账户风控与个体限次</h2><p class="caption">限制阻止新任务；已承诺任务可继续完成，用户仍可登录查看记录和申诉。</p><div class="table-scroll"><table><thead><tr><th>用户</th><th>可用 / 冻结 / 模拟完成</th><th>状态</th><th>日上限</th><th>操作</th></tr></thead><tbody>${d.users.map((u) => `<tr><td>${esc(u.name)}<div class="caption">${u.id.slice(0, 8)}</div></td><td>${u.balance} / ${u.frozen} / ${u.paid}</td><td>${u.status === "closed" ? "已注销" : u.status === "active" ? "正常" : "受限"}</td><td>${u.daily_limit ?? "默认"}</td><td><button class="button small light" ${u.status === "closed" ? "disabled" : ""} data-user="${u.id}" data-user-action="limit">设置上限</button><button class="button small secondary" ${u.status === "closed" ? "disabled" : ""} data-user="${u.id}" data-user-action="status">${u.status === "active" ? "限制新任务" : "恢复账户"}</button></td></tr>`).join("")}</tbody></table></div></section><section class="card"><h2>反馈与申诉</h2>${d.support.length ? d.support.map((t) => `<div class="audit-item"><div class="row"><span>${t.user_id.slice(0, 8)} · ${date(t.created_at)}</span><span class="status">${t.state === "resolved" ? "已回复" : "待处理"}</span></div><p class="support-message">${esc(t.message)}</p>${t.reply ? `<div class="notice">回复：${esc(t.reply)}</div>` : ""}<button class="button small light" data-reply="${t.id}">回复</button></div>`).join("") : '<p class="muted">暂无反馈</p>'}</section><section class="card"><h2>操作与风控审计</h2>${d.audit.map((a) => `<div class="audit-item"><div class="row"><span>${esc(a.action)} · ${esc(a.reference?.slice(0, 8))}</span><span>${date(a.created_at)}</span></div><div class="caption" style="overflow-wrap:anywhere">${esc(a.detail)}</div></div>`).join("") || '<p class="muted">暂无记录</p>'}</section>`;
  $(".admin-grid").insertAdjacentHTML("afterend", roomAdminView(d.roomContent));
  $("#dashboard").insertAdjacentHTML("beforeend", opsView(d));
  renderOpsSearch();
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
    toast(e.message);
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
document.addEventListener("submit", (e) => {
  if (e.target.id !== "settings-form") return;
  e.preventDefault();
  const patch = Object.fromEntries(
    [...new FormData(e.target)].map(([k, v]) => [k, Number(v)]),
  );
  run(async () => {
    await api("/settings", "PUT", patch);
    toast("规则已保存，已有任务及叠包金额保留");
  });
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled || busy) return;
  if (b.hasAttribute("data-refresh")) run(async () => {});
  if (b.dataset.review) {
    let reason = "";
    if (b.dataset.review === "reject") {
      reason = window.prompt("填写驳回原因，金币将退回");
      if (!reason?.trim()) return;
    }
    if (
      b.dataset.review === "simulate_pay" &&
      !window.confirm("确认仅模拟完成？不会向微信零钱付款。")
    )
      return;
    run(() =>
      api("/withdrawals/" + b.dataset.order + "/review", "POST", {
        action: b.dataset.review,
        reason,
      }),
    );
  }
  if (b.dataset.user) {
    const user = data.users.find((u) => u.id === b.dataset.user);
    let status = user.status,
      dailyLimit = user.daily_limit;
    if (b.dataset.userAction === "status")
      status = status === "active" ? "restricted" : "active";
    else {
      const v = window.prompt(
        "个人每日总上限0—100，留空跟随默认",
        dailyLimit ?? "",
      );
      if (v === null) return;
      dailyLimit = v.trim() === "" ? null : Number(v);
    }
    const reason = window.prompt("填写处置原因，至少2字，将记入审计");
    if (reason?.trim())
      run(() =>
        api("/users/" + user.id, "PUT", { status, dailyLimit, reason }),
      );
  }
  if (b.dataset.reply) {
    const reply = window.prompt("填写2—1000字回复");
    if (reply?.trim())
      run(() =>
        api("/support/" + b.dataset.reply + "/reply", "POST", { reply }),
      );
  }
});

bindRoomAdmin({ api, run, getRoom: () => data.roomContent, toast });

bindOps({ api, run, getData: () => data });

document.querySelector("#admin-enter").disabled = false;
document.querySelector("#admin-enter").textContent = "进入运营后台";
document.body.dataset.adminReady = "true";
