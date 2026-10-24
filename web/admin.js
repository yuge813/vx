const $ = selector => document.querySelector(selector)
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
let token = '', overview, busy = false, timer
const date = ms => new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const labels = { pending_review: '待审核', approved: '已审核', rejected: '已驳回', demo_paid: '模拟完成 · 未付款' }
const fields = [
  ['dailyAdLimit', '默认每日广告奖励上限', 0, 100], ['dailyBudgetCoins', '每日奖励总预算 / 金币', 0, 100000000],
  ['checkinCoins', '每日签到 / 金币', 0, 10000], ['chestBase', '宝箱基础奖励 / 金币', 1, 10000],
  ['bagBase', '福袋基础奖励 / 金币', 1, 10000], ['signinBase', '签到加奖基础 / 金币', 1, 10000],
  ['subsidyCoins', '每次广告任务补贴 / 金币', 0, 10000], ['chestCooldownSeconds', '宝箱冷却 / 秒', 120, 86400], ['bagCooldownSeconds', '福袋冷却 / 秒', 60, 86400]
]
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => { $('#toast').hidden = true }, 4500) }
async function api(path, method = 'GET', data) {
  const res = await fetch('/api/admin' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) })
  const reply = await res.json()
  if (!res.ok) { if (res.status === 401) logout(); throw new Error(reply.error?.message || '请求失败') }
  return reply
}
function logout() { token = ''; overview = null; $('#dashboard').hidden = true; $('#dashboard').innerHTML = ''; $('#login').hidden = false; $('#logout').hidden = true; $('#admin-token').value = '' }
async function load() { overview = await api('/overview'); render() }
function render() {
  const { config: c, budget: b, stats: s, users, withdrawals, audit } = overview
  $('#login').hidden = true; $('#logout').hidden = false; $('#dashboard').hidden = false
  $('#dashboard').innerHTML = `<div class="page-head"><div><div class="eyebrow">OPERATIONS OVERVIEW</div><h1>让每一笔奖励，都有依据</h1><div class="muted">业务日期 ${escape(b.day)}（北京时间） · 规则版本 v${c.version}</div></div><button class="button light small" data-refresh>刷新数据</button></div><div class="admin-stats">${[[s.users, '演示用户'], [b.spent, '今日已支出 / 金币'], [b.reserved, '已承诺预留 / 金币'], [s.frozen, '提现冻结 / 金币']].map(([n,l]) => `<div class="stat"><strong>${n.toLocaleString()}</strong><small>${l}</small></div>`).join('')}</div><div class="admin-grid"><section class="card"><h2>奖励与补贴规则</h2><p class="smallprint">只影响新任务；已经创建的任务保持原奖励。换算比例不支持在后台直接变更。</p><form id="settings-form">${fields.map(([key,label,min,max]) => `<label class="setting"><span>${label}</span><input class="field" name="${key}" type="number" min="${min}" max="${max}" step="1" required value="${c[key]}"></label>`).join('')}<button class="button" type="submit">保存新版本规则</button></form></section><div><section class="card"><h2>今日预算</h2><div class="balance">${Math.max(0,c.dailyBudgetCoins-b.spent-b.reserved).toLocaleString()}</div><div class="muted">剩余可承诺金币 / 总预算 ${c.dailyBudgetCoins.toLocaleString()}</div><div class="progress"><span style="width:${Math.min(100, (b.spent+b.reserved)/Math.max(1,c.dailyBudgetCoins)*100)}%"></span></div><ul class="steps"><li><b>1</b><span>任务创建即预留基础奖励与补贴。</span></li><li><b>2</b><span>完成任务后由预留转为支出。</span></li><li><b>3</b><span>取消或过期释放预留，不改已发奖励。</span></li></ul></section><section class="card feature"><h2>能力状态</h2><p>广告：${escape(c.adProvider)}<br>真实广告验证：未接入<br>真实微信转账：未接入<br>模拟转账：${c.demoTransfersEnabled ? '开发模式可用' : '已关闭'}<br>奖励换算：${c.coinsPerYuan}金币 / 演示元</p></section></div></div><section class="card"><div class="row"><h2>提现申请审核</h2><span class="pill">最近100条 · 开发演示</span></div><div class="table-scroll"><table><thead><tr><th>订单 / 用户</th><th>金币 / 演示金额</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>${withdrawals.map(o => `<tr><td title="${o.id}">${o.id.slice(0,8)}<div class="muted">${o.user_id.slice(0,8)}</div></td><td>${o.coins} / ¥${(o.amount_fen/100).toFixed(2)}</td><td>${labels[o.state]}${o.reason ? `<div class="muted">${escape(o.reason)}</div>` : ''}</td><td>${date(o.created_at)}</td><td>${o.state === 'pending_review' ? `<button class="button light small" data-order="${o.id}" data-review="approve">通过</button><button class="button danger small" data-order="${o.id}" data-review="reject">驳回</button>` : o.state === 'approved' ? `<button class="button secondary small" data-order="${o.id}" data-review="simulate_pay">模拟完成（不付款）</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5">暂无申请</td></tr>'}</tbody></table></div></section><section class="card"><h2>用户与频次控制</h2><p class="smallprint">每日限制针对新任务。限制账户不取消已承诺奖励，也不替代人工复核与申诉流程。</p><div class="table-scroll"><table><thead><tr><th>用户</th><th>可用 / 冻结 / 模拟完成</th><th>状态</th><th>单人日上限</th><th>操作</th></tr></thead><tbody>${users.map(u => `<tr><td title="${u.id}">${escape(u.name)}<div class="muted">${u.id.slice(0,8)}</div></td><td>${u.balance} / ${u.frozen} / ${u.paid}</td><td>${u.status === 'active' ? '正常' : '受限'}</td><td>${u.daily_limit ?? '跟随默认'}</td><td><button class="button light small" data-user="${u.id}" data-user-action="limit">设置上限</button><button class="button secondary small" data-user="${u.id}" data-user-action="status">${u.status === 'active' ? '限制新任务' : '恢复账户'}</button></td></tr>`).join('')}</tbody></table></div></section><section class="card"><h2>操作审计</h2><div class="table-scroll"><table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>记录</th></tr></thead><tbody>${audit.map(a => `<tr><td>${date(a.created_at)}</td><td>${escape(a.action)}</td><td>${escape(a.reference?.slice(0,8) || '—')}</td><td title="${escape(a.detail)}">${escape(a.detail.slice(0,140))}</td></tr>`).join('') || '<tr><td colspan="4">暂无操作</td></tr>'}</tbody></table></div></section>`
}
async function perform(fn) {
  if (busy) return; busy = true
  document.querySelectorAll('#dashboard button').forEach(b => { b.disabled = true })
  try { await fn(); await load() } catch (e) { toast(e.message); if (overview) render() } finally { busy = false }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; $('#login-error').textContent = ''
  token = $('#admin-token').value.trim()
  try { await load(); $('#admin-token').value = '' } catch (e) { token = ''; $('#login-error').textContent = e.message } finally { busy = false }
})
$('#logout').addEventListener('click', logout)
document.addEventListener('submit', event => {
  if (event.target.id !== 'settings-form') return; event.preventDefault()
  const values = Object.fromEntries(new FormData(event.target)); const patch = Object.fromEntries(Object.entries(values).map(([k,v]) => [k,Number(v)]))
  perform(async () => { await api('/settings', 'PUT', patch); toast('新规则已保存；原任务奖励保持不变') })
})
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled || busy) return
  if (button.hasAttribute('data-refresh')) perform(async () => {})
  if (button.dataset.review) {
    const action = button.dataset.review
    let reason = ''
    if (action === 'reject') { reason = window.prompt('填写驳回原因（金币将退回）'); if (!reason?.trim()) return }
    if (action === 'simulate_pay' && !window.confirm('仅将订单记为模拟完成，不会向微信付款。确认继续？')) return
    perform(() => api('/withdrawals/' + button.dataset.order + '/review', 'POST', { action, reason }))
  }
  if (button.dataset.user) {
    const user = overview.users.find(u => u.id === button.dataset.user)
    let status = user.status, dailyLimit = user.daily_limit
    if (button.dataset.userAction === 'status') status = status === 'active' ? 'restricted' : 'active'
    else {
      const value = window.prompt('每日奖励次数上限：0—100，留空跟随默认', user.daily_limit ?? '')
      if (value === null) return; dailyLimit = value.trim() === '' ? null : Number(value)
    }
    const reason = window.prompt('填写处置或调整原因（至少2字，记入审计）'); if (!reason?.trim()) return
    perform(() => api('/users/' + user.id, 'PUT', { status, dailyLimit, reason }))
  }
})
