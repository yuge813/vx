const $ = selector => document.querySelector(selector)
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const state = { config: null, user: null, plans: [], ledger: [], orders: [], page: 'home', busy: false, offset: 0 }
let token = localStorage.getItem('xingxiang.token') || '', toastTimer
const money = coins => ((coins || 0) / state.config.coinsPerYuan).toFixed(2)
const date = ms => new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const labels = { pending_review: '待审核（演示）', approved: '已审核 · 待模拟转账', rejected: '已驳回 · 金币已退回', demo_paid: '模拟完成 · 未向微信付款' }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true }, 4000) }
async function api(path, method = 'GET', data) {
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) })
  const payload = await response.json()
  if (!response.ok) { const error = new Error(payload.error?.message || '请求失败'); error.status = response.status; throw error }
  return payload
}
async function initialize() {
  state.config = await api('/config')
  if (token) { try { await api('/me') } catch (e) { if (e.status !== 401) throw e; token = ''; localStorage.removeItem('xingxiang.token') } }
  if (!token) {
    if (state.config.mode !== 'development') throw new Error('浏览器只提供开发登录；正式登录请在已配置的小程序内使用。')
    let installationId = localStorage.getItem('xingxiang.installation')
    if (!installationId) { installationId = crypto.randomUUID(); localStorage.setItem('xingxiang.installation', installationId) }
    const result = await api('/auth/demo', 'POST', { installationId }); token = result.token; localStorage.setItem('xingxiang.token', token)
  }
  await refresh(); render()
}
async function refresh() {
  const [user, plans, ledger, orders, config] = await Promise.all([api('/me'), api('/plans'), api('/ledger'), api('/withdrawals'), api('/config')])
  Object.assign(state, { user, plans, ledger, orders, config, offset: user.serverTime - Date.now() })
}
function header(kicker, title, subtitle) { return `<header class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><div class="subtitle">${subtitle}</div></div><span class="head-label">✦ 星享 · 成长体验</span></header><div class="notice">开发体验版：模拟广告无收益，演示金币不可兑现，模拟转账不会进入微信零钱。</div>` }
function hero(title = '我的演示金币', currency = false) { return `<section class="card hero"><div class="row"><span>${title}</span><span class="pill">非真实资金</span></div><div class="balance">${currency ? '¥ ' + money(state.user.balance) : state.user.balance.toLocaleString()}</div><div class="muted">${currency ? state.user.balance + ' 金币' : '演示换算 ¥' + money(state.user.balance)} · ${state.config.coinsPerYuan}金币演示换算1元</div></section>` }
function stats(items) { return `<div class="stats">${items.map(([number, text]) => `<div class="stat"><strong>${escape(number)}</strong><small>${text}</small></div>`).join('')}</div>` }
function home() {
  const u = state.user, c = state.config
  return header('A LITTLE BETTER, EVERY DAY', '今天，也值得期待', '认真生活的每一天，都有属于你的小成就。') + `<div class="grid"><div>${hero()}${stats([[u.earnedToday, '今日奖励 / 金币'], [u.adsToday + ' / ' + u.dailyLimit, '已完成演示任务'], [state.plans.filter(p => p.done).length, '已完成小计划']])}<section class="card"><div class="row"><h2>每日签到</h2><span class="pill">＋${c.checkinCoins} 金币</span></div><div class="muted">签到免费完成，坚持从一件小事开始。</div><div class="week">${(u.week || []).map(d => `<div class="day ${d.signed ? 'active' : ''}"><span>${d.signed ? '✓' : '✦'}</span>${escape(d.label)}</div>`).join('')}</div><button class="button" data-action="checkin" ${u.signedToday ? 'disabled' : ''}>${u.signedToday ? '✓ 今日已签到' : '签到领取金币'}</button>${u.signedToday && c.adProvider === 'demo' ? '<button class="button light" data-claim="signin_bonus">可选：演示广告加奖</button>' : ''}</section><section class="card"><div class="row"><h2>今日小计划</h2><span class="muted">先做一件小事</span></div><div class="list">${state.plans.map(p => `<div class="plan ${p.done ? 'done' : ''}"><input type="checkbox" id="plan-${p.id}" data-plan="${p.id}" ${p.done ? 'checked' : ''}><label for="plan-${p.id}">${escape(p.title)}</label><button class="delete" data-delete="${p.id}" aria-label="删除计划">×</button></div>`).join('')}</div><form id="plan-form" class="plan-form"><input class="field" id="plan-title" placeholder="添加今天想完成的小事" maxlength="60" required aria-label="新计划"><button class="button light" type="submit">添加</button></form></section></div><div><section class="card feature"><div class="feature-icon">❋</div><h2>把日子整理成<br>喜欢的样子</h2><p>列一份小清单，完成一次整理。<br>不看广告，也可以保存你的日常进度。</p><span class="pill">今日灵感 · 从桌面开始</span></section><section class="card"><div class="row"><h2>暖心宝箱</h2><span class="pill">固定奖励</span></div><div class="envelope"><div class="seal">享</div></div><div class="reward-amount">${c.chestBase + c.subsidyCoins}<small> 金币</small></div><div class="muted">基础 ${c.chestBase} ＋ 运营补贴 ${c.subsidyCoins}</div><button class="button light" data-nav="chests">去宝箱广场看看 →</button></section><p class="hint">每一笔奖励都可以查看流水。<br>关闭页面不会扣除已获得的金币。</p></div></div>`
}
function chests() {
  const c = state.config
  return header('A SMALL SURPRISE FOR YOU', '宝箱广场', '离开页面也能继续计时，不用留在这里等待。') + `<div class="grid"><section class="card chest-card"><div class="row"><h2>暖心宝箱</h2><span class="pill">基础＋运营补贴</span></div><div class="envelope"><div class="seal">享</div></div><div class="reward-amount">${c.chestBase} ＋ ${c.subsidyCoins}<small> 金币</small></div><div class="muted">当前规则展示，领取前以任务确认金额为准</div><div class="timer" id="chest-timer">02:00</div><div class="muted" id="chest-caption">下一份小惊喜正在准备</div><div class="progress"><span id="chest-progress"></span></div><button class="button" data-claim="chest" id="chest-open" disabled>等待宝箱准备完成</button><p class="muted">单次保留一个机会，不无限叠加。<br>演示任务只产生演示金币。</p></section><div><section class="card lavender"><div class="row"><h2>成长福袋</h2><span class="pill">固定奖励 · 非抽奖</span></div><p class="muted">奖励清清楚楚，没有随机中奖概率。</p><div class="reward-amount">${c.bagBase} ＋ ${c.subsidyCoins}<small> 金币</small></div><button class="button light" data-claim="bag" id="bag-open">体验演示福袋</button></section><section class="card"><h2>你的奖励如何入账？</h2><ol class="steps"><li><b>1</b><span>主动选择，先确认任务和奖励。</span></li><li><b>2</b><span>开发版完成3秒模拟流程。</span></li><li><b>3</b><span>基础奖励、补贴分开记录。</span></li></ol></section>${c.mode === 'development' ? '<button class="button secondary" data-action="ready">开发工具：推进倒计时</button><p class="hint">该工具仅用于测试，生产模式关闭。</p>' : ''}</div></div>`
}
function orderRows() { return state.orders.length ? state.orders.map(o => `<div class="list-item"><div class="row"><strong>¥${(o.amount_fen / 100).toFixed(2)}</strong><span class="status">${labels[o.state] || escape(o.state)}</span></div><div class="muted">${date(o.created_at)}</div>${o.reason ? `<div class="muted">处理说明：${escape(o.reason)}</div>` : ''}</div>`).join('') : '<div class="empty">还没有申请记录</div>' }
function ledgerRows() { return state.ledger.map(l => `<div class="list-item"><div class="row"><span>${escape(l.title)}</span><span class="amount ${l.available_delta < 0 ? 'minus' : ''}">${l.available_delta > 0 ? '+' : ''}${l.available_delta}</span></div><div class="muted">${date(l.created_at)}${l.frozen_delta ? ' · 冻结变动 ' + l.frozen_delta : ''}</div></div>`).join('') || '<div class="empty">暂无金币流水</div>' }
function wallet() {
  const c = state.config, pending = JSON.parse(localStorage.getItem('xingxiang.pendingWithdrawal') || 'null')
  return header('EVERY LITTLE REWARD COUNTS', '我的钱包', '每一份收获，都有清晰的来处和去向。') + `<div class="grid"><div>${hero('演示可用金额', true)}${stats([['¥' + money(state.user.frozen), '申请冻结中'], ['¥' + money(state.user.paid), '模拟完成金额'], [state.orders.length, '演示申请数']])}<section class="card"><h2>演示提现申请</h2><p class="muted">最低${c.minimumWithdrawalCoins}金币，提交后冻结。后台驳回将退回金币，模拟转账不会向微信付款。</p><form id="withdraw-form"><label class="muted" for="withdraw-coins">申请金币数量</label><input id="withdraw-coins" class="field" type="number" min="${c.minimumWithdrawalCoins}" step="10" required value="${pending?.coins ?? 1000}"><div class="row" style="margin-top:15px"><span class="muted">演示换算</span><strong id="withdraw-amount">¥${money(pending?.coins ?? 1000)}</strong></div><button class="button" type="submit" ${!c.demoTransfersEnabled ? 'disabled' : ''}>${pending ? '重试上次演示申请' : c.demoTransfersEnabled ? '提交演示申请' : '真实提现尚未开放'}</button></form></section><section class="card"><h2>申请记录</h2>${orderRows()}</section></div><section class="card"><div class="row"><h2>金币收支</h2><span class="pill">最近100笔</span></div>${ledgerRows()}</section></div>`
}
function profile() { return header('YOUR OWN LITTLE CORNER', '我的成长空间', '慢一点也没关系，坚持会留下痕迹。') + `<div class="grid"><div><section class="card"><div class="row" style="justify-content:flex-start"><div class="avatar">✦</div><div><h2>${escape(state.user.name)}</h2><div class="muted">用户编号 ${state.user.id.slice(0, 8)}</div><span class="pill">${state.user.status === 'restricted' ? '账户受限 · 可申诉' : '每一份坚持，都有意义'}</span></div></div></section><section class="card"><button class="profile-link" data-nav="wallet">金币收支与申请记录 <span>›</span></button><button class="profile-link" data-action="rules">奖励规则 <span>›</span></button><button class="profile-link" data-action="privacy">隐私与数据说明 <span>›</span></button><button class="profile-link" data-action="support">客服与申诉 <span>›</span></button><a class="profile-link" href="/admin">运营后台 <span>↗</span></a></section>${state.config.adProvider === 'demo' ? '<button class="button light" data-claim="bag">继续未完成的演示任务</button>' : ''}</div><div><section class="card feature"><div class="feature-icon">✺</div><h2>让成长<br>有迹可循</h2><p>基础奖励与补贴分别记账。<br>申请冻结、退回、模拟完成都有流水。</p></section><p class="hint">开发版不读取通讯录、位置或剪贴板。<br>正式发布仍需完成企业客服、隐私与注销流程。</p></div></div>` }
function render() {
  $('#app').innerHTML = ({ home, chests, wallet, profile }[state.page] || home)() + '<div class="footer">星享成长 · 让日常多一点小成就</div>'
  document.querySelectorAll('#navigation button').forEach(b => { b.classList.toggle('active', b.dataset.page === state.page); b.setAttribute('aria-current', b.dataset.page === state.page ? 'page' : 'false') })
  tick()
}
function tick() {
  if (!state.user) return
  const now = Date.now() + state.offset, left = Math.max(0, Math.ceil((state.user.nextChestAt - now) / 1000)), bag = Math.max(0, Math.ceil((state.user.nextBagAt - now) / 1000))
  if ($('#chest-timer')) {
    $('#chest-timer').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0')
    $('#chest-caption').textContent = left ? '下一份小惊喜正在准备' : '宝箱已准备好'
    $('#chest-progress').style.width = Math.min(100, Math.max(0, 100 - left / state.config.chestCooldownSeconds * 100)) + '%'
    $('#chest-open').disabled = state.busy || left > 0 || state.config.adProvider !== 'demo'
    $('#chest-open').textContent = state.config.adProvider !== 'demo' ? '广告尚未接入' : left ? '等待宝箱准备完成' : '开启演示宝箱'
  }
  if ($('#bag-open')) { $('#bag-open').disabled = state.busy || bag > 0 || state.config.adProvider !== 'demo'; $('#bag-open').textContent = bag ? bag + '秒后可领取' : '体验演示福袋' }
}
async function reward(kind) {
  if (state.config.adProvider !== 'demo') throw new Error('真实广告尚未接入')
  let task, saved = localStorage.getItem('xingxiang.pendingTask')
  if (saved) {
    try { task = await api('/tasks/' + saved) } catch (e) { if (e.status !== 404) throw e; localStorage.removeItem('xingxiang.pendingTask') }
    if (task?.state === 'rewarded') { localStorage.removeItem('xingxiang.pendingTask'); toast('已恢复上次任务：演示金币已入账'); return }
    if (task && task.state !== 'pending') { localStorage.removeItem('xingxiang.pendingTask'); task = null }
  }
  if (!task) { task = await api('/tasks', 'POST', { kind }); localStorage.setItem('xingxiang.pendingTask', task.id) }
  $('#reward-description').textContent = `基础 ${task.base} ＋ 补贴 ${task.subsidy}，合计 ${task.total} 演示金币。`
  $('#reward-confirm').textContent = '开始3秒演示'; $('#reward-confirm').disabled = false; $('#reward-cancel').disabled = false; $('#demo-progress').style.width = '0%'
  const dialog = $('#reward-dialog'); dialog.showModal()
  await new Promise((resolve, reject) => {
    let finished = false
    const cleanup = () => { dialog.removeEventListener('cancel', cancel); $('#reward-cancel').onclick = null; $('#reward-confirm').onclick = null }
    const cancel = async event => {
      event?.preventDefault(); if (finished) return; finished = true; cleanup()
      try { await api('/tasks/' + task.id + '/cancel', 'POST', {}); localStorage.removeItem('xingxiang.pendingTask'); dialog.close(); resolve() } catch (e) { dialog.close(); reject(e) }
    }
    dialog.addEventListener('cancel', cancel); $('#reward-cancel').onclick = cancel
    $('#reward-confirm').onclick = async () => {
      if (finished) return; finished = true; cleanup(); $('#reward-confirm').disabled = true; $('#reward-cancel').disabled = true
      const prevent = e => e.preventDefault(); dialog.addEventListener('cancel', prevent)
      try {
        for (let n = 1; n <= 3; n++) { $('#reward-confirm').textContent = `演示进行中 ${4 - n}秒`; await new Promise(r => setTimeout(r, 1050)); $('#demo-progress').style.width = n / 3 * 100 + '%' }
        await api('/tasks/' + task.id + '/complete', 'POST', {}); localStorage.removeItem('xingxiang.pendingTask'); toast('演示金币已入账，可查看基础奖励和补贴流水'); resolve()
      } catch (e) { reject(e) } finally { dialog.removeEventListener('cancel', prevent); dialog.close() }
    }
  })
}
async function perform(fn) {
  if (state.busy) return
  state.busy = true; document.querySelectorAll('#app button').forEach(b => { b.disabled = true })
  try { await fn(); await refresh() } catch (e) { toast(e.message || '网络异常，请稍后重试') }
  finally { state.busy = false; render() }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return
  const page = button.dataset.page || button.dataset.nav
  if (page) { if (!state.busy && state.user) { state.page = page; render(); window.scrollTo(0, 0) }; return }
  if (button.dataset.claim) { perform(() => reward(button.dataset.claim)); return }
  if (button.dataset.delete) { perform(() => api('/plans/' + button.dataset.delete, 'DELETE')); return }
  const action = button.dataset.action
  if (action === 'checkin') perform(async () => { await api('/checkin', 'POST', {}); toast('签到成功') })
  if (action === 'ready') perform(() => api('/dev/ready', 'POST', {}))
  if (action === 'retry') initialize().catch(e => toast(e.message))
  if (action === 'rules') window.alert('开发版奖励不可兑现。签到免费；宝箱和福袋均为固定演示奖励。任务创建时锁定基础奖励与补贴，按服务端时间执行冷却及每日上限。取消不发奖，成功只记账一次。没有随机抽奖或无限叠包。')
  if (action === 'privacy') window.alert('开发版在浏览器本地保存会话令牌、演示安装标识及未完成请求编号。服务器保存账户、计划、流水和申请记录。不读取通讯录、位置、剪贴板。正式上线前需完善企业隐私指引、保留期限、注销与客服。')
  if (action === 'support') window.alert('开发版尚未配置真实客服。正式运营需配置企业客服及申诉渠道。你的用户编号：' + state.user.id)
})
document.addEventListener('change', event => { if (event.target.dataset.plan) perform(() => api('/plans/' + event.target.dataset.plan, 'PUT', { done: event.target.checked })) })
document.addEventListener('input', event => { if (event.target.id === 'withdraw-coins') $('#withdraw-amount').textContent = '¥' + money(Number(event.target.value)) })
document.addEventListener('submit', event => {
  event.preventDefault()
  if (event.target.id === 'plan-form') { const title = $('#plan-title').value; perform(() => api('/plans', 'POST', { title })) }
  if (event.target.id === 'withdraw-form') {
    const coins = Number($('#withdraw-coins').value)
    perform(async () => {
      let pending = JSON.parse(localStorage.getItem('xingxiang.pendingWithdrawal') || 'null')
      if (pending && pending.coins !== coins) throw new Error('上一申请结果待确认，请使用原金额重试：' + pending.coins + '金币')
      if (!pending) { pending = { coins, requestKey: crypto.randomUUID() }; localStorage.setItem('xingxiang.pendingWithdrawal', JSON.stringify(pending)) }
      try { await api('/withdrawals', 'POST', pending); localStorage.removeItem('xingxiang.pendingWithdrawal'); toast('演示申请已提交，金币已冻结') }
      catch (e) { if (e.status && e.status < 500) localStorage.removeItem('xingxiang.pendingWithdrawal'); throw e }
    })
  }
})
setInterval(tick, 1000)
initialize().catch(e => { $('#app').innerHTML = `<div class="error">${escape(e.message)}<button class="button light" data-action="retry">重新连接</button></div>` })
