import { $, esc, date, toast } from "./shared.js";
const names = {
  ad_settled: "最终广告结算收入",
  content: "内容成本",
  infrastructure: "基础设施",
  staff: "人工",
  acquisition: "获客",
  fulfillment: "权益履约",
  other: "其他费用",
};
const yuan = (fen) => (fen / 100).toFixed(2);
export function opsView(data) {
  const r = data.report,
    totals = r.rows.reduce(
      (a, b) => ({
        revenueFen: a.revenueFen + b.revenueFen,
        expenseFen: a.expenseFen + b.expenseFen,
        coins: a.coins + b.baseCoins + b.subsidyCoins,
        completed: a.completed + b.completed,
      }),
      { revenueFen: 0, expenseFen: 0, coins: 0, completed: 0 },
    );
  return `<section id="operations" class="section"><div class="row"><h2>经营报表与账务核对</h2><button class="button small light" data-ops-export>导出当前报表</button></div><p class="caption">${esc(r.notice)}</p><div class="admin-stats">${[
    [yuan(totals.revenueFen), "人工录入结算收入/元"],
    [yuan(totals.expenseFen), "人工录入现金费用/元"],
    [totals.coins, "已发开发金币"],
    [totals.completed, "已完成奖励任务"],
  ]
    .map(
      ([v, l]) =>
        `<div class="stat"><strong>${v}</strong><small>${l}</small></div>`,
    )
    .join(
      "",
    )}</div><div class="admin-grid"><section class="card"><h3>内部账务对账</h3><p class="${data.reconciliation.ok ? "reconcile-good" : "error"}">${data.reconciliation.ok ? "检查通过：账户、流水、冻结和预算一致" : "发现差异，请停止新增奖励并人工核对"}</p><p class="caption">${esc(data.reconciliation.scope)} · ${date(data.reconciliation.checkedAt)}</p>${data.reconciliation.issues.map((i) => `<div class="audit-item">${esc(i.type)} · ${esc(i.id)}<div>应为${esc(i.expected)}，实际${esc(i.actual)}</div></div>`).join("")}<h3>按日统计</h3><div class="table-scroll"><table><thead><tr><th>日期</th><th>新账户</th><th>任务用户/次数</th><th>基础/补贴金币</th><th>录入净收支/元</th></tr></thead><tbody>${r.rows.map((row) => `<tr><td>${row.day}</td><td>${row.newAccounts}</td><td>${row.taskUsers}/${row.completed}</td><td>${row.baseCoins}/${row.subsidyCoins}</td><td>${yuan(row.recordedNetFen)}</td></tr>`).join("")}</tbody></table></div></section><section class="card"><h3>凭账单录入现金收支</h3><form id="business-entry-form"><label class="field-label">类型<select name="kind" class="field">${Object.entries(
    names,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      "",
    )}</select></label><label class="field-label">业务日期<input class="field" type="date" name="day" value="${r.rows.at(-1).day}" required></label><label class="field-label">金额（分，整数）<input class="field" name="amountFen" type="number" min="1" max="1000000000" step="1" required></label><label class="field-label">唯一账单编号<input class="field" name="reference" minlength="2" maxlength="100" required></label><label class="field-label">账单说明<input class="field" name="memo" minlength="2" maxlength="200" required></label><button class="button" type="submit">保存人工账单</button></form><p class="caption">请使用最终结算账单，不填预估eCPM、展示次数或模拟收益。金额不改动用户金币。</p><div class="room-admin-list">${r.entries.map((e) => `<div class="audit-item"><div class="row"><strong>${names[e.kind]} ¥${yuan(e.amount_fen)}</strong>${e.voided ? '<span class="caption">已冲销</span>' : `<button class="link" data-entry-void="${e.id}">冲销</button>`}</div><div class="caption">${e.day} · ${esc(e.reference)}</div><p>${esc(e.memo)}</p></div>`).join("") || '<p class="empty">暂无人工录入账单。</p>'}</div></section></div><section class="card"><h3>用户查询与流水</h3><form id="user-search-form" class="field-row"><input class="field" name="query" placeholder="按昵称或账户编号查询" maxlength="100"><button class="button small" type="submit">查询</button></form><div id="user-search-result" class="caption">查询结果仅显示业务账户，不暴露微信openid或会话。</div><div id="user-detail-result"></div></section><section class="card"><h3>账号注销申请</h3><p class="caption">有余额、冻结或未完成任务不能审核通过；通过后移除登录关联和非账务文本，必要账务与审计保留。</p>${data.closures.map((c) => `<div class="audit-item"><div class="row"><strong>${esc(c.name)} · ${esc(c.user_id.slice(0, 8))}</strong><span data-closure-state="${c.state}">${{ pending: "待审核", approved: "已注销", rejected: "已退回" }[c.state] || esc(c.state)}</span></div><p>${esc(c.reason)}</p>${c.decision ? `<p class="caption">${esc(c.decision)}</p>` : ""}${c.state === "pending" ? `<button class="button small light" data-closure-review="approve" data-request-key="${c.id}">审核注销</button><button class="button small secondary" data-closure-review="reject" data-request-key="${c.id}">退回申请</button>` : ""}</div>`).join("") || '<p class="empty">暂无申请。</p>'}</section></section>`;
}
export function saveJSON(name, data) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function bindOps({ api, run, getData }) {
  document.addEventListener("submit", (e) => {
    if (e.target.id === "business-entry-form") {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.amountFen = Number(body.amountFen);
      run(async () => {
        await api("/business-entries", "POST", body);
        toast("人工账单已保存");
      });
    }
    if (e.target.id === "user-search-form") {
      e.preventDefault();
      run(async () => {
        const q = new FormData(e.target).get("query"),
          data = await api("/users?q=" + encodeURIComponent(q));
        sessionStorage.setItem("yx.admin.search", JSON.stringify(data));
      });
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.entryVoid) {
      const reason = window.prompt("输入冲销原因，原记录保留");
      if (reason?.trim())
        run(() =>
          api("/business-entries/" + b.dataset.entryVoid + "/void", "POST", {
            reason,
          }),
        );
    }
    if (b.dataset.closureReview) {
      const reason = window.prompt("填写审核依据，至少2字");
      if (reason?.trim() && window.confirm("确认该注销审核操作？"))
        run(async () => {
          await api("/closures/" + b.dataset.requestKey + "/review", "POST", {
            action: b.dataset.closureReview,
            reason,
          });
          sessionStorage.removeItem("yx.admin.search");
          sessionStorage.removeItem("yx.admin.detail");
        });
    }
    if (b.hasAttribute("data-ops-export"))
      saveJSON("经营报表.json", getData().report);
    if (b.dataset.userDetail)
      run(async () => {
        const detail = await api("/users/" + b.dataset.userDetail + "/detail");
        sessionStorage.setItem("yx.admin.detail", JSON.stringify(detail));
      });
  });
}
export function renderOpsSearch() {
  try {
    const results = JSON.parse(
        sessionStorage.getItem("yx.admin.search") || "null",
      ),
      detail = JSON.parse(sessionStorage.getItem("yx.admin.detail") || "null");
    if (results && $("#user-search-result"))
      $("#user-search-result").innerHTML =
        `共${results.total}条${results.items.map((u) => `<div class="activity-row"><span>${esc(u.name)} · ${u.id.slice(0, 8)} · ${u.balance}金币 · ${u.status}</span><button class="link" data-user-detail="${u.id}">账户流水</button></div>`).join("")}`;
    if (detail && $("#user-detail-result"))
      $("#user-detail-result").innerHTML =
        `<h3>${esc(detail.user.name)}的最近流水</h3>${detail.ledger.map((l) => `<div class="activity-row"><span>${esc(l.title)}<small class="caption">${date(l.created_at)}</small></span><strong>${l.available_delta}</strong></div>`).join("") || '<p class="empty">暂无流水。</p>'}`;
  } catch {
    sessionStorage.removeItem("yx.admin.search");
    sessionStorage.removeItem("yx.admin.detail");
  }
}
