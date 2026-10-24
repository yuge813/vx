const api = require('../../services/client')
const states = { pending_review: '待审核（演示）', approved: '已审核 · 待模拟转账', rejected: '已驳回 · 金币已退回', demo_paid: '模拟完成 · 未向微信付款' }
Page({
  data: { user: {}, config: {}, coins: '1000', orders: [], busy: false, amount: '1.00', error: '' },
  onShow() { this.load() },
  async load() {
    try {
      await getApp().ready()
      const [config, user, orders] = await Promise.all([api.request('/api/config'), api.request('/api/me'), api.request('/api/withdrawals')])
      this.setData({ user, config, balance: api.money(user.balance), frozen: api.money(user.frozen), paid: api.money(user.paid), orders: orders.map(o => ({ ...o, label: states[o.state], amount: (o.amount_fen / 100).toFixed(2), time: api.time(o.created_at) })), error: '' })
    } catch (error) { this.setData({ error: error.message }); api.toast(error) }
  },
  input(e) { this.setData({ coins: e.detail.value, amount: api.money(Number(e.detail.value)) }) },
  async withdraw() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const coins = Number(this.data.coins)
      let pending = wx.getStorageSync('xingxiang_pending_withdrawal')
      if (pending && pending.coins !== coins) throw new Error('上次申请结果待确认，请使用原金额' + pending.coins + '金币重试')
      if (!pending) { pending = { coins, requestKey: 'withdraw_' + Date.now() + '_' + Math.random().toString(36).slice(2) }; wx.setStorageSync('xingxiang_pending_withdrawal', pending) }
      await api.request('/api/withdrawals', 'POST', pending)
      wx.removeStorageSync('xingxiang_pending_withdrawal'); wx.showToast({ title: '演示申请已提交' }); await this.load()
    } catch (error) { if (error.status && error.status < 500) wx.removeStorageSync('xingxiang_pending_withdrawal'); api.toast(error) } finally { this.setData({ busy: false }) }
  },
  records() { wx.navigateTo({ url: '/pages/records/index' }) }
})
