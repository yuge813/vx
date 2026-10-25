import {
  $,
  esc,
  icon,
  date,
  shortTime,
  toast,
  downloadJSON,
} from "./shared.js";
const state = {
  page: "home",
  user: null,
  config: null,
  group: null,
  ledger: [],
  orders: [],
  historyCursor: null,
  referral: null,
  support: [],
  busy: false,
  hidden: {},
  adPreview: { enabled: false, current: null },
  walletCoins: 1000,
  offset: 0,
};
const nav = [
  ["home", "home", "首页"],
  ["group", "packet", "红包"],
  ["bag", "video", "视频"],
  ["invite", "invite", "邀请"],
  ["profile", "profile", "我的"],
];
const orderLabels = {
  pending_review: "待审核（模拟）",
  approved: "已审核，待模拟完成",
  rejected: "已驳回，金币已退回",
  demo_paid: "模拟完成，未向微信付款",
};
let token = localStorage.getItem("yx.token") || "",
  pollBusy = false,
  adPacer = null,
  adPacerAccount = "",
  adPreviewSignature = "";
const money = (coins) =>
  ((coins || 0) / (state.config?.coinsPerYuan || 1000)).toFixed(2);
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
  const v = await r.json();
  if (!r.ok) {
    const e = new Error(v.error?.message || "请求失败");
    e.status = r.status;
    throw e;
  }
  return v;
}
async function initialize() {
  state.config = await api("/config");
  if (token)
    try {
      await api("/me");
    } catch (e) {
      if (e.status !== 401) throw e;
      token = "";
      localStorage.removeItem("yx.token");
    }
  if (!token) {
    if (state.config.mode !== "development")
      throw new Error("浏览器开发登录已关闭，请使用已配置微信登录的小程序。");
    let installationId = localStorage.getItem("yx.installation");
    if (!installationId) {
      installationId = crypto.randomUUID();
      localStorage.setItem("yx.installation", installationId);
    }
    const r = await api("/auth/demo", "POST", { installationId });
    token = r.token;
    localStorage.setItem("yx.token", token);
  }
  const invite = new URLSearchParams(location.search).get("invite");
  if (invite)
    try {
      await api("/referral/bind", "POST", { code: invite.toUpperCase() });
    } catch (e) {
      toast(e.message);
    }
  await refresh();
  render();
}
async function refresh() {
  [
    state.user,
    state.config,
    state.group,
    state.ledger,
    state.orders,
    state.referral,
    state.support,
  ] = await Promise.all([
    api("/me"),
    api("/config"),
    api(
      "/group" +
        (state.page === "group" && !document.hidden && !state.busy
          ? "?active=1"
          : ""),
    ),
    api("/ledger"),
    api("/withdrawals"),
    api("/referral"),
    api("/support"),
  ]);
  state.user = state.group.user;
  state.offset = state.user.serverTime - Date.now();
}
function canClaim(kind, bank = null) {
  if (state.config.adProvider !== "demo") return false;
  if (state.user.pendingTask) return state.user.pendingTask.kind === kind;
  return (
    state.user.status === "active" &&
    state.user.remaining[kind] > 0 &&
    (!bank || bank.coins > 0)
  );
}
function header(kicker, title, text) {
  return `<header class="page-head"><div class="eyebrow">${kicker}</div><h1>${title}</h1><div class="muted">${text}</div></header><div class="notice">开发联调 · 广告为显式模拟，金币不可兑现，模拟完成不向微信付款。</div>`;
}
function hero(currency = false) {
  return `<section class="card hero"><div class="row"><span>${currency ? "金币演示换算" : "我的金币"}</span><span class="pill">${currency ? "非真实资金" : "开发账户"}</span></div><div class="balance">${currency ? "¥ " + money(state.user.balance) : state.user.balance.toLocaleString()}${currency ? "" : "<small>金币</small>"}</div><div class="row"><span class="muted">${currency ? state.user.balance + "金币" : state.config.coinsPerYuan + "金币演示换算1元"}</span><button class="link" style="color:#ffe1ba" data-nav="wallet">${currency ? "演示提现" : "打开金币钱包"} ${icon("arrow")}</button></div></section>`;
}
function stats(rows) {
  return `<div class="stats">${rows.map(([n, s]) => `<div class="stat"><strong>${esc(n)}</strong><small>${s}</small></div>`).join("")}</div>`;
}
function week() {
  return `<div class="week">${state.user.week.map((d) => `<div class="week-day ${d.signed ? "signed" : ""}"><span>${d.signed ? icon("check") : d.dayNumber || d.day.slice(-2)}</span>${esc(d.label)}</div>`).join("")}</div>`;
}
function recentLedger(limit = 5) {
  return state.ledger.length
    ? state.ledger
        .slice(0, limit)
        .map(
          (l) =>
            `<div class="activity-row"><div><strong>${esc(l.title)}</strong><time>${date(l.created_at)}</time>${l.frozen_delta ? `<div class="caption">冻结变动 ${l.frozen_delta} 金币</div>` : ""}</div><span class="${l.available_delta < 0 ? "negative" : "positive"}">${l.available_delta > 0 ? "+" : ""}${l.available_delta}</span></div>`,
        )
        .join("")
    : '<div class="empty">还没有金币记录。完成签到或打开红包后，这里会显示真实的开发流水。</div>';
}
function home() {
  const u = state.user,
    c = state.config;
  return (
    header(
      "EVERY DAY, A LITTLE MORE JOY",
      "签到攒金币，惊喜每天有。",
      "签到、红包群、宝箱和福袋，都在这里。",
    ) +
    `<div class="grid"><div>${hero()}${stats([
      [u.earnedToday, "今日已入账 / 金币"],
      [u.adsToday + " / " + u.dailyLimit, "今日完成 / 总上限"],
      [u.frozen, "申请冻结 / 金币"],
    ])}<section class="card"><div class="row"><h2>每日签到</h2><span class="pill">基础${c.signinBase}＋补贴${c.subsidyCoins}</span></div><p class="muted">完成签到激励任务后入账，每个业务日限领一次。</p>${week()}<button class="button full" data-claim="signin" ${u.signedToday || !canClaim("signin") ? "disabled" : ""}>${u.signedToday ? "今日已签到" : c.adProvider === "demo" ? "模拟签到，领取金币" : "广告未接入，签到奖励关闭"}${icon("gift")}</button></section><div class="shortcuts">${[
      ["group", "packet", "红包群", "每两分钟继续叠包"],
      ["bag", "bag", "幸运福袋", "每分钟一次机会"],
      ["invite", "invite", "邀请好友", "单层关系记录"],
    ]
      .map(
        ([p, i, t, s]) =>
          `<button class="shortcut" data-nav="${p}">${icon(i)}<strong>${t}</strong><small>${s}</small></button>`,
      )
      .join(
        "",
      )}</div><section class="card"><div class="row"><h2>最近金币动态</h2><button class="link" data-nav="records">全部流水 ${icon("arrow")}</button></div>${recentLedger()}</section></div><aside><section class="card art-card"><div class="row"><h2>红包群正在等你</h2><span class="pill">可叠至${c.packetCap}</span></div><img src="/assets/packet.svg" alt="原创红包插画"><div class="reward-value">${state.group.banks.find((b) => b.kind === "redpacket")?.coins || 0}<small>当前待领金币</small></div><p class="muted">觉得少可以暂不打开，继续等待下一轮。金额由服务端累计，并有预算预留。</p><button class="button full" data-nav="group">进入红包群 ${icon("arrow")}</button></section><section class="card"><h2>每一笔，清清楚楚</h2><ol class="steps"><li><b>1</b><span>先确认基础奖励和补贴，再自主参与。</span></li><li><b>2</b><span>开发模拟成功后，服务端只记账一次。</span></li><li><b>3</b><span>演示提现先冻结，驳回退回，绝不显示虚假微信到账。</span></li></ol></section>${u.pendingTask ? '<button class="button secondary full" data-action="resume">继续未完成的任务</button>' : ""}</aside></div>`
  );
}
function paceAds() {
  if (!state.user || !state.config) return false;
  const key = "yx.ad-preview." + state.user.id;
  if (!adPacer || adPacerAccount !== state.user.id) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || "{}");
    } catch {}
    adPacer = new window.AdPreviewPacing.Pacing(state.config.adPacing, saved);
    adPacerAccount = state.user.id;
  }
  adPacer.configure(state.config.adPacing);
  state.adPreview = adPacer.sample(
    performance.now(),
    state.page === "group" &&
      !document.hidden &&
      !state.busy &&
      !$("#reward-dialog").open &&
      !state.user.pendingTask,
    Date.now() + state.offset,
  );
  const signature = JSON.stringify([
    state.adPreview.enabled,
    state.adPreview.current?.id,
    state.adPreview.current?.format,
    state.adPreview.sessionCount,
    state.adPreview.dayCount,
    state.adPreview.capped,
  ]);
  if (signature === adPreviewSignature) return false;
  adPreviewSignature = signature;
  try {
    localStorage.setItem(key, JSON.stringify(adPacer.snapshot()));
  } catch {}
  return true;
}
function adScheduleText() {
  const p = state.config.adPacing;
  return `开发广告位预览：信息流首次${p.native.firstDelay}秒，间隔至少${p.native.interval}秒；横幅首次${p.banner.firstDelay}秒，间隔至少${p.banner.interval}秒。每次位置预览${p.duration}秒，类型错开至少${p.minGap}秒，关闭后冷却${p.closeCooldown}秒。\n每会话最多${p.sessionLimit}次，本机本账户每日最多${p.dailyLimit}次。仅累计群页面前台空闲时间；切后台、离开或有奖励任务时暂停，不补弹。\n插屏关闭，未核实适用场景及规则。所有秒数为开发设计，不是微信许可频次。预览不计曝光、收入或金币，正式环境关闭。本机次数只用于体验控制，不是后端反作弊。`;
}
function roomPacket(b, contentText = "") {
  const saved = state.hidden[b.kind] === b.generation + ":" + b.coins;
  if (saved)
    return `<div class="chat-saved" data-bank="${b.kind}"><div>已暂存 <strong>${b.coins}金币</strong></div><small>金额保留，下一轮继续叠加。</small><button class="link" data-restore="${b.kind}">查看暂存${b.kind === "redpacket" ? "红包" : "宝箱"}</button></div>`;
  const ready = b.coins > 0,
    envelope = b.kind === "redpacket";
  const art = envelope
    ? '<span class="packet-envelope" aria-hidden="true"><i></i><b>金</b></span>'
    : '<img src="/assets/chest.svg" alt="">';
  return `<div class="chat-packet ${envelope ? "is-envelope" : "is-treasure"} ${!ready ? "is-waiting" : ""}" data-bank="${b.kind}"><button class="packet-open" data-claim="${b.kind}" aria-label="${envelope ? "查看金币红包，显示开字面板" : "查看宝箱"}" ${!canClaim(b.kind, b) ? "disabled" : ""}>${art}<span class="packet-copy"><strong>${esc(ready ? contentText || (envelope ? "恭喜发财，大吉大利" : "宝箱已准备，惊喜等你开") : envelope ? "下一份红包正在准备" : "下一份宝箱正在准备")}</strong><span>${b.locked ? "继续上次领取任务" : ready ? (envelope ? "点击拆红包" : "点击开启宝箱") : "倒计时结束后可领取"}</span><b class="reward-value">${b.coins}<small> 金币待领</small></b></span></button>${ready && !b.locked ? `<button class="packet-close" data-skip="${b.kind}" aria-label="暂不打开，继续叠加">×</button>` : ""}<div class="packet-bottom"><span>${envelope ? "金币红包 · 开发奖励" : "金币宝箱 · 开发奖励"}</span><span data-timer="${b.kind}"></span></div><div class="packet-track"><span data-bank-progress="${b.kind}"></span></div></div><div class="packet-hint">${b.atCap ? "已达本轮上限，可选择打开" : b.paused ? "新增累计暂停，已叠金币保留" : `每轮＋${b.increment} · 本轮上限${b.cap}`}</div>`;
}
function roomMessage(row) {
  const avatar = row.avatar
    ? `<img class="room-avatar portrait-avatar" src="/assets/${esc(row.avatar)}.svg" alt="${esc(row.actor)}的活动头像">`
    : `<div class="room-avatar avatar-${row.type === "packet" ? row.bank.kind : row.type}">${esc(row.mark)}</div>`;
  const head = `<div class="message-head"><span class="message-sender">${esc(row.actor)}${row.badge ? `<small class="assistant-badge">${esc(row.badge)}</small>` : ""}</span>${row.createdAt ? `<time>${shortTime(row.createdAt)}</time>` : "<small>系统</small>"}</div>`;
  let body;
  if (row.type === "packet") body = roomPacket(row.bank, row.text);
  else if (row.type === "packet_history")
    body = `<div class="history-packet ${row.packetKind === "treasure" ? "history-treasure" : ""}"><span class="history-envelope">${icon(row.packetKind === "treasure" ? "chest" : "packet")}</span><div><strong>${esc(row.text)}</strong><small>${esc(row.detail)}</small></div></div>`;
  else if (row.type === "ad")
    body = `<div class="chat-ad" data-ad-preview="native"><div class="ad-art">${icon("video")}</div><div><strong>${esc(row.text)}</strong><span>${esc(row.detail)}</span><small>开发占位 · 未接入</small></div><button data-action="hide-ad" aria-label="关闭广告占位">×</button></div>`;
  else
    body = `<div class="message-bubble ${row.type === "notice" ? "notice-bubble" : ""}">${esc(row.text)}${row.coins ? `<strong>${row.coins}金币</strong>` : ""}${row.detail ? `<small>${esc(row.detail)}</small>` : ""}</div>`;
  return `<article class="room-message ${row.type === "notice" ? "room-announcement" : ""}" data-message="${esc(row.id)}">${avatar}<div class="message-body">${head}${body}</div></article>`;
}
function group() {
  const room = state.group.room;
  const rows = [...state.group.messages];
  if (state.adPreview.current?.format === "native")
    rows.splice(Math.max(1, rows.length - 1), 0, {
      id: state.adPreview.current.id,
      type: "ad",
      actor: "广告位预览",
      mark: "告",
      text: "信息流位置预览",
      detail: "未加载广告，不产生曝光或收入。",
    });
  const banner =
    state.adPreview.current?.format === "banner"
      ? `<aside class="room-ad-banner" data-ad-preview="banner"><span class="banner-badge">横幅预览</span><div><strong>等待期广告展示位置</strong><small>开发布局 · 无真实广告与收益</small></div><button data-action="hide-ad" aria-label="关闭横幅预览">×</button></aside>`
      : "";
  return `<section class="room-shell"><header class="room-top"><h1 title="${esc(room.title)}（${room.memberCount}）">${esc(room.title)}<span>（${room.memberCount}）</span></h1><div class="room-wallet"><span class="coin-emblem">金</span><strong>${state.user.balance.toLocaleString()}</strong><button class="room-withdraw" data-nav="wallet" aria-label="打开演示提现钱包">提现</button></div></header><div class="room-mode">开发联调 · 金币不可兑现 · 人数为注册账户数，非在线人数</div><div class="room-disclosure">${esc(state.group.roomDisclosure)}</div><div class="room-stage"><button class="lucky-float" data-nav="bag" aria-label="打开幸运福袋"><span class="lucky-tip">点击领奖</span><img src="/assets/bag.svg" alt=""><strong>福袋</strong></button><div class="room-scroll feed">${rows.map(roomMessage).join("")}<div class="room-end">活动消息由运营方发布 · 金币以账户流水为准</div></div></div>${banner}<footer class="room-tools"><button class="link" data-action="rules">玩法说明</button>${state.adPreview.enabled ? `<button class="link" data-action="ad-schedule" data-ad-status>广告预览 ${state.adPreview.sessionCount}/${state.config.adPacing.sessionLimit}</button>` : ""}${state.user.pendingTask ? '<button class="link" data-action="resume">恢复未完成任务</button>' : ""}${state.config.mode === "development" ? '<button class="link" data-action="advance">开发：推进一轮</button>' : ""}</footer></section>`;
}
function bag() {
  const c = state.config;
  return (
    header(
      "A LITTLE LUCK, A CLEAR REWARD",
      "视频任务与幸运福袋",
      "概率公开，抽取结果由服务端锁定；当前只提供开发联调。",
    ) +
    `<div class="grid"><section class="card bag-hero"><span class="pill">今日剩余 ${state.user.remaining.bag} 次</span><img src="/assets/bag.svg" alt="原创福袋插画"><h2>这一袋，会有多少金币？</h2><div class="muted">基础${Math.min(...c.prizes.filter((p) => p.weight).map((p) => p.coins))}—${Math.max(...c.prizes.filter((p) => p.weight).map((p) => p.coins))}金币，另加补贴${c.subsidyCoins}</div><div class="countdown" id="bag-countdown">00:00</div><button class="button full" data-claim="bag" id="bag-open">开始模拟，抽取福袋</button><p class="caption">取消同样进入冷却，不支持反复挑选结果。没有付费抽取。</p></section><aside><section class="card"><div class="row"><h2>奖励概率</h2><span class="pill">基础金币，不含补贴</span></div><div class="probability">${c.prizes.map((p) => `<div class="prize ${p.coins === 500 ? "top" : ""}"><strong>${p.coins}</strong><small>金币 · 概率${p.weight}%</small></div>`).join("")}</div><p class="caption">这些是本版可配置的开发规则，不代表元享真实概率。未核实随机现金激励的适用规则。</p></section><section class="card"><h2>最近奖励记录</h2>${recentLedger(4)}</section>${c.mode === "development" ? '<button class="button secondary full" data-action="advance">开发工具：结束冷却</button>' : ""}</aside></div>`
  );
}
function wallet() {
  const pending = JSON.parse(localStorage.getItem("yx.withdrawal") || "null"),
    coins = pending?.coins ?? state.walletCoins;
  return (
    header(
      "EVERY COIN HAS A RECORD",
      "金币钱包",
      "余额、冻结和处理结果分开记录，演示金额不代表真实资金。",
    ) +
    `<div class="grid"><div>${hero(true)}${stats([
      [money(state.user.frozen), "演示冻结 / 元"],
      [money(state.user.paid), "模拟完成 / 元"],
      [state.orders.length, "演示申请数"],
    ])}<section class="card"><h2>提现到微信零钱 · 开发流程</h2><p class="muted">实际微信转账尚未接入。以下只测试申请、冻结、审核、驳回和模拟完成。</p><div class="wallet-choices">${[1000, 2000, 5000].map((n) => `<button class="wallet-choice ${coins === n ? "active" : ""}" data-coins="${n}"><strong>¥${money(n)}</strong>${n}金币</button>`).join("")}</div><form id="withdraw-form"><label class="field-label" for="withdraw-coins">申请金币数量（最低${state.config.minimumWithdrawalCoins}）</label><input class="field" id="withdraw-coins" type="number" min="${state.config.minimumWithdrawalCoins}" step="10" value="${coins}" required><button class="button full" type="submit" ${!state.config.demoTransfersEnabled ? "disabled" : ""}>${pending ? "重试上次演示申请" : "提交演示提现申请"}</button></form></section><section class="card"><h2>申请记录</h2>${state.orders.length ? state.orders.map((o) => `<div class="activity-row"><div><strong>¥${(o.amount_fen / 100).toFixed(2)} · ${o.coins}金币</strong><time>${date(o.created_at)}</time>${o.reason ? `<div class="caption">处理原因：${esc(o.reason)}</div>` : ""}</div><span class="status">${orderLabels[o.state]}</span></div>`).join("") : '<div class="empty">还没有提现申请。</div>'}</section></div><section class="card"><div class="row"><h2>金币流水</h2><button class="link" data-nav="records">全部 ${icon("arrow")}</button></div>${recentLedger(12)}</section></div>`
  );
}
function records() {
  return (
    header(
      "YOUR COIN HISTORY",
      "每一笔金币，都有记录。",
      "基础、补贴、冻结、退回和模拟完成分开保留。",
    ) +
    `<section class="card"><div class="row"><h2>金币流水（可分页）</h2><span class="pill">服务端账务</span></div>${recentLedger(10000)}${state.historyCursor ? '<button class="button light full" data-action="history-more">加载更早记录</button>' : ""}</section>`
  );
}
function invite() {
  const r = state.referral,
    link = location.origin + "/?invite=" + r.code;
  return (
    header(
      "INVITE WITH A CLEAR CONNECTION",
      "邀请好友，一起体验。",
      "只记录真实的单层邀请关系，现金返佣未开放。",
    ) +
    `<div class="grid"><div><section class="card"><h2>我的邀请码</h2><div class="invite-code">${esc(r.code)}</div><input class="field" id="invite-link" readonly value="${esc(link)}" aria-label="邀请链接"><button class="button full" data-action="copy-invite">复制邀请链接</button><p class="caption">微信小程序通过用户主动分享携带邀请码。无需强制分享，不以分享换取提现资格。</p></section>${stats(
      [
        [r.invitedCount, "真实邀请 / 人"],
        [r.activeCount, "完成任务 / 人"],
        [r.bound ? "已绑定" : "未绑定", "我的邀请关系"],
      ],
    )}<section class="card"><h2>绑定邀请关系</h2><form id="bind-form"><label class="field-label" for="bind-code">好友的邀请码（注册24小时内可绑定一次）</label><input class="field" id="bind-code" maxlength="12" pattern="[A-Fa-f0-9]{12}" required ${r.bound ? "disabled" : ""}><button class="button light full" type="submit" ${r.bound ? "disabled" : ""}>${r.bound ? "已绑定，不能更改" : "绑定邀请码"}</button></form></section></div><section class="card"><h2>最近邀请记录</h2>${r.users.length ? r.users.map((u) => `<div class="activity-row"><div><strong>用户 ${esc(u.id)}</strong><time>${date(u.createdAt)}</time></div><span class="status">${u.active ? "已完成开发任务" : "尚未完成任务"}</span></div>`).join("") : '<div class="empty">没有邀请记录，页面不会填造用户或收益。</div>'}</section></div>`
  );
}
function support() {
  return (
    header(
      "SUPPORT AND APPEALS",
      "遇到问题，说清楚就好。",
      "账户受限也可以提交反馈；请勿填写密码、令牌或支付密钥。",
    ) +
    `<div class="grid"><section class="card"><h2>客服与申诉</h2><p class="muted">当前反馈进入本项目内部后台，正式企业客服尚待配置。</p><form id="support-form"><label class="field-label" for="support-message">问题或申诉说明</label><textarea class="field" id="support-message" minlength="2" maxlength="1000" rows="6" required placeholder="请描述任务时间、类型、现象或订单编号"></textarea><button class="button full" type="submit">提交反馈</button></form></section><section class="card"><h2>我的反馈记录</h2>${state.support.length ? state.support.map((t) => `<div class="audit-item"><div class="row"><span>${date(t.created_at)}</span><span class="status">${t.state === "resolved" ? "已回复" : "待处理"}</span></div><p class="support-message">${esc(t.message)}</p>${t.reply ? `<div class="notice">回复：${esc(t.reply)}</div>` : ""}</div>`).join("") : '<div class="empty">还没有反馈记录。</div>'}</section></div>`
  );
}
function profile() {
  return (
    header(
      "YOUR REWARDS SPACE",
      "我的金币空间",
      "账户、任务与奖励状态，都可以在这里查看。",
    ) +
    `<div class="grid"><div><section class="card"><div class="row" style="justify-content:flex-start"><div class="avatar">享</div><div><h2>${esc(state.user.name)}</h2><div class="caption">编号 ${state.user.id.slice(0, 8)}</div><span class="pill">${state.user.status === "active" ? "开发账户" : "账户受限，可提交申诉"}</span></div></div></section>${hero()}<section class="card">${[
      ["wallet", "wallet", "金币钱包与演示提现"],
      ["records", "records", "全部金币流水"],
      ["invite", "invite", "邀请与推广记录"],
      ["support", "support", "客服、反馈与申诉"],
    ]
      .map(
        ([p, i, t]) =>
          `<button class="profile-link" data-nav="${p}"><span>${icon(i)}${t}</span>${icon("arrow")}</button>`,
      )
      .join(
        "",
      )}<button class="profile-link" data-action="rules"><span>${icon("records")}玩法及奖励规则</span>${icon("arrow")}</button><button class="profile-link" data-action="capabilities"><span>${icon("lock")}广告与支付能力</span>${icon("arrow")}</button><button class="profile-link" data-nav="privacy"><span>${icon("profile")}数据与隐私说明</span>${icon("arrow")}</button><a class="profile-link" href="/admin"><span>${icon("records")}运营管理后台</span>${icon("arrow")}</a></section>${state.user.pendingTask ? '<button class="button light full" data-action="resume">恢复未完成任务</button>' : ""}</div><aside><section class="card"><h2>今日剩余次数</h2>${Object.entries(
      { signin: "签到", redpacket: "红包", treasure: "宝箱", bag: "福袋" },
    )
      .map(
        ([k, t]) =>
          `<div class="activity-row"><strong>${t}</strong><span class="pill">${state.user.remaining[k]} 次</span></div>`,
      )
      .join(
        "",
      )}<p class="caption">同时受每日总上限约束。所有次数由后端核验，不能通过改页面绕过。</p></section><section class="card art-card"><img src="/assets/chest.svg" alt="原创宝箱插画"><h2>基础奖励与补贴，分开入账。</h2><p class="caption">任务创建后固定金额，后台改规则不追减已承诺奖励。</p></section></aside></div>`
  );
}
function privacy() {
  const u = state.user,
    c = u.closureRequest;
  return (
    header(
      "ACCOUNT AND PRIVACY",
      "账户与隐私",
      "管理昵称、导出最近记录、退出会话及申请注销。",
    ) +
    `<div class="grid"><div><section class="card"><h2>个人昵称</h2><form id="profile-name-form"><input class="field" name="name" minlength="1" maxlength="16" value="${esc(u.name)}" required><button class="button small" type="submit">保存昵称</button></form></section><section class="card"><h2>数据说明 · 内部审核稿</h2><p class="caption">运营主体：${esc(state.config.operator?.name || "待配置")} · 联系方式：${esc(state.config.operator?.contact || "待配置")}</p><p class="muted">保存登录关联、账户、任务、流水、演示申请、邀请关系、群消息进度与反馈。本机保存会话、任务恢复及广告位预览冷却，不读取通讯录、位置或相册。</p><p class="muted">导出本账户最近100条各类记录，隐藏微信openid、会话和密钥。更多金币流水在记录页分页查看。正式运营前需完善企业主体、客服、保存期限及适用平台隐私声明。</p><button class="button light" data-action="export-account">导出最近账户JSON</button></section><button class="button secondary" data-action="logout">退出全部登录会话</button></div><section class="card"><h2>申请注销账户</h2>${c ? `<div class="notice">状态：${esc({ pending: "待审核", approved: "已注销", rejected: "已退回" }[c.state] || c.state)} ${esc(c.decision || "")}</div>` : ""}<p class="muted">先处理已入账余额、冻结申请和未完成任务。确认放弃未领取的开发奖励；审核后移除登录关联与非账务文本，保留必要账务及审计。申请处理中暂停新增奖励。</p><form id="account-closure-form"><textarea class="field" name="reason" minlength="2" maxlength="200" required placeholder="2—200字申请原因"></textarea><label class="room-checkbox"><input type="checkbox" name="discardUnclaimed" required>确认放弃尚未领取的开发奖励并了解保留范围</label><button class="button" type="submit" ${u.balance || u.frozen || u.pendingTask || c?.state === "pending" ? "disabled" : ""}>提交注销申请</button></form></section></div>`
  );
}
function render() {
  if (!state.user) return;
  paceAds();
  document.body.classList.toggle("room-open", state.page === "group");
  const oldFeed = $(".feed"),
    scroll = oldFeed?.scrollTop || 0,
    nearBottom =
      !oldFeed || oldFeed.scrollHeight - scroll - oldFeed.clientHeight < 30;
  $("#navigation").innerHTML = nav
    .map(
      ([p, i, t]) =>
        `<button data-nav="${p}" class="${state.page === p ? "active" : ""}" aria-current="${state.page === p ? "page" : "false"}">${icon(i)}<span>${t}</span></button>`,
    )
    .join("");
  $("#app").innerHTML =
    (
      { home, group, bag, wallet, records, invite, support, profile, privacy }[
        state.page
      ] || home
    )() +
    (state.page === "group"
      ? ""
      : '<footer class="footer">悦享金币 · 元享式玩法独立开发版</footer>');
  $("#app").setAttribute("aria-busy", "false");
  if ($(".feed"))
    $(".feed").scrollTop = nearBottom ? $(".feed").scrollHeight : scroll;
  tick();
}
function tick() {
  if (!state.user) return;
  if (paceAds()) {
    render();
    return;
  }
  const now = Date.now() + state.offset;
  for (const b of state.group?.banks || []) {
    const el = $('[data-timer="' + b.kind + '"]'),
      progress = $('[data-bank-progress="' + b.kind + '"]');
    if (el) {
      const left = Math.max(0, Math.ceil((b.nextAt - now) / 1000));
      el.textContent = b.atCap
        ? "已到上限"
        : b.locked
          ? "金额已锁定"
          : b.paused
            ? "累计已暂停"
            : String(Math.floor(left / 60)).padStart(2, "0") +
              ":" +
              String(left % 60).padStart(2, "0");
      if (progress)
        progress.style.width =
          (b.atCap
            ? 100
            : Math.min(100, Math.max(0, 100 - (left / b.interval) * 100))) +
          "%";
    }
  }
  if ($("#bag-countdown")) {
    const left = Math.max(0, Math.ceil((state.user.nextBagAt - now) / 1000));
    $("#bag-countdown").textContent = left
      ? String(Math.floor(left / 60)).padStart(2, "0") +
        ":" +
        String(left % 60).padStart(2, "0")
      : "福袋已准备好";
    $("#bag-open").disabled =
      state.busy ||
      !canClaim("bag") ||
      (state.user.pendingTask?.kind !== "bag" && left > 0);
  }
}
async function claim(kind) {
  if (state.config.adProvider !== "demo") throw new Error("真实广告尚未接入");
  let task;
  const saved = localStorage.getItem("yx.task") || state.user.pendingTask?.id;
  if (saved) {
    try {
      task = await api("/tasks/" + saved);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (task?.state === "rewarded") {
      localStorage.removeItem("yx.task");
      toast("已恢复原任务：金币已入账，不会重复领取");
      return;
    }
    if (task && task.state !== "pending") {
      localStorage.removeItem("yx.task");
      task = null;
    }
  }
  if (!task) {
    task = await api("/tasks", "POST", { kind });
    localStorage.setItem("yx.task", task.id);
  } else localStorage.setItem("yx.task", task.id);
  const description = task.rewardRange
    ? `福袋基础${task.rewardRange.min}—${task.rewardRange.max}金币，另加补贴${task.subsidy}。结果已在服务端锁定，完成前不公开。`
    : `基础${task.base}＋补贴${task.subsidy}，合计${task.total}开发金币。`;
  const packet = ["redpacket", "treasure"].includes(task.kind);
  const source = state.group?.messages.find(
    (r) => r.type === "packet" && r.bank.kind === task.kind,
  );
  const dialog = $("#reward-dialog");
  dialog.className = packet
    ? "packet-reveal" + (task.kind === "treasure" ? " treasure-reveal" : "")
    : "";
  dialog.dataset.phase = "ready";
  $("#reward-dismiss").hidden = !packet;
  $("#reward-dismiss").disabled = false;
  $("#packet-sender").hidden = !packet;
  $("#packet-reward").hidden = !packet;
  $("#packet-avatar").src =
    "/assets/" + (source?.avatar || "avatar-peach") + ".svg";
  $("#packet-actor").textContent = source?.actor || "活动助手";
  $("#packet-caption").textContent =
    "活动助手发来的金币" + (task.kind === "treasure" ? "宝箱" : "红包");
  $("#packet-total").textContent = task.total;
  $("#packet-state").textContent = "待领取";
  $("#reward-title").textContent = packet
    ? source?.text || "恭喜发财，大吉大利"
    : task.title || "金币任务";
  $("#reward-description").textContent = description;
  $("#reward-confirm").disabled = false;
  $("#reward-confirm").textContent = packet ? "开" : "开始3秒模拟";
  $("#reward-confirm").setAttribute(
    "aria-label",
    packet ? "开，开始3秒开发模拟领取金币" : "开始3秒模拟",
  );
  $("#reward-cancel").disabled = false;
  $("#reward-cancel").textContent = packet
    ? "暂不打开，保留已叠金币"
    : "取消，保留已叠金币";
  $(".packet-disclaimer").innerHTML =
    "点击「开」开始3秒开发模拟，无真实广告。<br>金币不可兑现，不向微信付款。";
  $("#reward-progress").style.width = "0%";
  dialog.showModal();
  if (packet) $("#reward-confirm").focus();
  await new Promise((resolve, reject) => {
    let chosen = false;
    const cleanup = () => {
      dialog.removeEventListener("cancel", cancel);
      $("#reward-confirm").onclick = null;
      $("#reward-cancel").onclick = null;
      $("#reward-dismiss").onclick = null;
    };
    const cancel = async (e) => {
      e?.preventDefault();
      if (chosen) return;
      chosen = true;
      cleanup();
      try {
        await api("/tasks/" + task.id + "/cancel", "POST", {});
        localStorage.removeItem("yx.task");
        dialog.close();
        resolve();
      } catch (e) {
        dialog.close();
        reject(e);
      }
    };
    dialog.addEventListener("cancel", cancel);
    $("#reward-cancel").onclick = cancel;
    $("#reward-dismiss").onclick = cancel;
    $("#reward-confirm").onclick = async () => {
      if (chosen) return;
      chosen = true;
      cleanup();
      const prevent = (e) => e.preventDefault();
      dialog.addEventListener("cancel", prevent);
      $("#reward-confirm").disabled = true;
      $("#reward-cancel").disabled = true;
      $("#reward-dismiss").disabled = true;
      dialog.dataset.phase = "opening";
      let keepReceipt = false;
      try {
        for (let n = 1; n <= 3; n++) {
          $("#reward-confirm").textContent = packet
            ? "开"
            : "模拟进行中 " + (4 - n) + "秒";
          if (packet)
            $("#packet-state").textContent = "开发模拟中 · " + (4 - n) + "秒";
          await new Promise((r) => setTimeout(r, 1050));
          $("#reward-progress").style.width = (n / 3) * 100 + "%";
        }
        const result = await api("/tasks/" + task.id + "/complete", "POST", {});
        localStorage.removeItem("yx.task");
        if (packet) {
          keepReceipt = true;
          dialog.dataset.phase = "received";
          $("#reward-title").textContent = "开发金币已入账";
          $("#packet-total").textContent = result.task.total;
          $("#packet-state").textContent = "已领取 · 基础与补贴分别记账";
          $(".packet-disclaimer").innerHTML =
            "本次奖励已记入金币流水。<br>金币不可兑现，不向微信付款。";
          $("#reward-confirm").disabled = false;
          $("#reward-dismiss").disabled = false;
          $("#reward-confirm").textContent = "收下，继续叠包";
          $("#reward-confirm").setAttribute("aria-label", "收下，继续叠包");
          const finishReceipt = (event) => {
            event?.preventDefault();
            dialog.removeEventListener("cancel", finishReceipt);
            cleanup();
            dialog.close();
            resolve();
          };
          dialog.addEventListener("cancel", finishReceipt);
          $("#reward-confirm").onclick = finishReceipt;
          $("#reward-dismiss").onclick = finishReceipt;
          $("#reward-confirm").focus();
        } else {
          toast(
            (result.task.total || 0) + "开发金币已入账，可查看基础及补贴流水",
          );
          resolve();
        }
      } catch (e) {
        reject(e);
      } finally {
        dialog.removeEventListener("cancel", prevent);
        if (!keepReceipt) dialog.close();
      }
    };
  });
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  paceAds();
  document.querySelectorAll("[data-ad-preview]").forEach((el) => {
    (el.closest(".room-message") || el).remove();
  });
  $("#app").setAttribute("aria-busy", "true");
  document.querySelectorAll("#app button").forEach((b) => {
    b.disabled = true;
  });
  try {
    await fn();
    await refresh();
  } catch (e) {
    toast(e.message || "网络失败，请重新查询原任务或原订单");
  } finally {
    state.busy = false;
    render();
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled || state.busy) return;
  try {
    if (b.dataset.nav) {
      if (state.page === "group" && b.dataset.nav !== "group")
        api("/group/presence", "POST", { active: false }).catch(() => {});
      state.page = b.dataset.nav;
      render();
      window.scrollTo(0, 0);
      if (state.page === "group") refreshRoom();
      if (state.page === "records") {
        const history = await api("/history?type=ledger");
        state.ledger = history.items;
        state.historyCursor = history.nextCursor;
        render();
      }
      return;
    }
    if (b.dataset.claim) {
      await run(() => claim(b.dataset.claim));
      return;
    }
    if (b.dataset.skip) {
      await run(async () => {
        const bank = state.group.banks.find((x) => x.kind === b.dataset.skip);
        await api("/group/skip", "POST", { kind: bank.kind });
        state.hidden[bank.kind] = bank.generation + ":" + bank.coins;
        toast("已暂存，金币保留并继续等待叠加");
      });
      return;
    }
    if (b.dataset.restore) {
      delete state.hidden[b.dataset.restore];
      render();
      return;
    }
    if (b.dataset.coins) {
      state.walletCoins = Number(b.dataset.coins);
      render();
      return;
    }
    const a = b.dataset.action;
    if (a === "hide-ad") {
      adPacer.close(Date.now() + state.offset);
      render();
      return;
    }
    if (a === "ad-schedule") window.alert(adScheduleText());
    if (a === "advance") await run(() => api("/dev/ready", "POST", {}));
    if (a === "resume")
      await run(() => claim(state.user.pendingTask?.kind || "signin"));
    if (a === "copy-invite") {
      const el = $("#invite-link");
      try {
        await navigator.clipboard.writeText(el.value);
        toast("邀请链接已复制");
      } catch {
        el.select();
        toast("请按Ctrl+C复制已选中的链接");
      }
    }
    if (a === "rules")
      window.alert(
        state.group.banks
          .map(
            (b) =>
              `${b.title}：每${b.interval}秒增加${b.increment}金币，本轮上限${b.cap}。`,
          )
          .join("\n") +
          `\n可暂存，任务创建后锁金额；福袋${state.config.bagCooldownSeconds}秒冷却，概率公开；补贴单独记账。参数为开发规则，金币不可兑现。`,
      );
    if (a === "capabilities")
      window.alert(
        "真实激励、横幅、插屏和原生广告未接入。观看模拟不产生收入。单次收益和手机权重API未核实；实际微信零钱转账及邀请现金返佣关闭。",
      );
    if (a === "privacy")
      window.alert(
        "开发版保存安装标识、会话、任务、金币流水、演示申请、单层邀请关系、活动消息进度与发布记录及反馈；本机保存广告位预览次数和关闭冷却，不上报为广告曝光或收入。不读取通讯录、位置、相册或剪贴板。正式运营还需主体隐私声明、保留期限、注销和企业客服流程。",
      );
    if (a === "retry") await initialize();
    if (a === "history-more") {
      const r = await api("/history?type=ledger&cursor=" + state.historyCursor);
      state.ledger = [...state.ledger, ...r.items];
      state.historyCursor = r.nextCursor;
      render();
    }
    if (a === "export-account")
      downloadJSON("我的最近账户记录.json", await api("/account/export"));
    if (
      a === "logout" &&
      window.confirm("退出全部已有会话？账户数据将保留。")
    ) {
      await api("/auth/logout", "POST", { all: true });
      for (const key of ["yx.token", "yx.task", "yx.withdrawal"])
        localStorage.removeItem(key);
      token = "";
      state.user = null;
      state.page = "home";
      adPacer = null;
      $("#app").innerHTML =
        '<section class="card"><h1>已有会话已退出</h1><p>账户数据保留，重新登录后继续查看。</p><button class="button" data-action="retry">重新登录</button></section>';
    }
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy) return;
  if (e.target.id === "profile-name-form") {
    run(() =>
      api("/profile", "PUT", { name: new FormData(e.target).get("name") }),
    );
  }
  if (
    e.target.id === "account-closure-form" &&
    window.confirm("确认提交注销申请，并放弃未领取的开发奖励？")
  ) {
    run(() =>
      api("/account/closure", "POST", {
        reason: new FormData(e.target).get("reason"),
        discardUnclaimed: true,
      }),
    );
  }
  if (e.target.id === "withdraw-form") {
    const coins = Number($("#withdraw-coins").value);
    run(async () => {
      let pending = JSON.parse(localStorage.getItem("yx.withdrawal") || "null");
      if (pending && pending.coins !== coins)
        throw new Error(
          "上次结果待确认，请使用原金额" + pending.coins + "金币重试",
        );
      if (!pending) {
        pending = { coins, requestKey: crypto.randomUUID() };
        localStorage.setItem("yx.withdrawal", JSON.stringify(pending));
      }
      try {
        await api("/withdrawals", "POST", pending);
        localStorage.removeItem("yx.withdrawal");
        toast("演示申请已提交，金币已冻结");
      } catch (e) {
        if (e.status && e.status < 500)
          localStorage.removeItem("yx.withdrawal");
        throw e;
      }
    });
  }
  if (e.target.id === "bind-form") {
    const code = $("#bind-code").value.toUpperCase();
    run(async () => {
      await api("/referral/bind", "POST", { code });
      toast("邀请关系已绑定，未发放现金佣金");
    });
  }
  if (e.target.id === "support-form") {
    const message = $("#support-message").value;
    run(async () => {
      await api("/support", "POST", { message });
      toast("反馈已保存，可在此查看回复");
    });
  }
});
document.addEventListener("visibilitychange", () => {
  tick();
  if (document.hidden && state.user)
    api("/group/presence", "POST", { active: false }).catch(() => {});
  else refreshRoom();
});
setInterval(tick, 1000);
async function refreshRoom() {
  if (
    state.page !== "group" ||
    state.busy ||
    pollBusy ||
    document.hidden ||
    $("#reward-dialog").open ||
    !state.user
  )
    return;
  pollBusy = true;
  try {
    state.group = await api("/group?active=1");
    state.user = state.group.user;
    state.offset = state.group.serverTime - Date.now();
    if (state.page === "group") render();
  } catch (e) {
    toast(e.message);
  } finally {
    pollBusy = false;
  }
}
setInterval(refreshRoom, 5000);
initialize().catch((e) => {
  $("#app").innerHTML =
    `<div class="error">${esc(e.message)}<button class="button light" data-action="retry">重新连接</button></div>`;
});
