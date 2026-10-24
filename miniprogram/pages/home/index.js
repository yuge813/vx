const api = require('../../services/client')
Page({
  data: { user: {}, plans: [], busy: false, draft: '', week: [1,2,3,4,5,6,7], config: {}, error: '' },
  onShow() { this.load() },
  async load() {
    try {
      await getApp().ready()
      const [config, user, plans] = await Promise.all([api.request('/api/config'), api.request('/api/me'), api.request('/api/plans')])
      this.setData({ user, plans, config, money: api.money(user.balance), error: '' })
    } catch (error) { this.setData({ error: error.message }); api.toast(error) }
  },
  input(e) { this.setData({ draft: e.detail.value }) },
  async addPlan() { if (this.data.busy) return; this.setData({ busy: true }); try { await api.request('/api/plans', 'POST', { title: this.data.draft }); this.setData({ draft: '' }); await this.load() } catch (e) { api.toast(e) } finally { this.setData({ busy: false }) } },
  async toggle(e) { try { const item = this.data.plans.find(p => p.id === e.currentTarget.dataset.id); await api.request('/api/plans/' + item.id, 'PUT', { done: !item.done }); await this.load() } catch (error) { api.toast(error) } },
  async remove(e) { try { await api.request('/api/plans/' + e.currentTarget.dataset.id, 'DELETE'); await this.load() } catch (error) { api.toast(error) } },
  async checkin() {
    if (this.data.busy) return; this.setData({ busy: true })
    try { await api.request('/api/checkin', 'POST', {}); await this.load(); wx.showToast({ title: '签到完成' }) } catch (error) { api.toast(error) } finally { this.setData({ busy: false }) }
  },
  async bonus() { if (this.data.busy) return; this.setData({ busy: true }); try { const result = await api.claim('signin_bonus'); if (result) wx.showToast({ title: '演示金币已入账' }); await this.load() } catch (error) { api.toast(error) } finally { this.setData({ busy: false }) } },
  chests() { wx.switchTab({ url: '/pages/chests/index' }) }
})
