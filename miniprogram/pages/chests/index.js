const api = require('../../services/client')
Page({
  data: { user: {}, config: {}, remaining: 0, timer: '02:00', progress: 0, busy: false, bagRemaining: 0, error: '' },
  onShow() { this.load(); this._timer = setInterval(() => this.tick(), 1000) },
  onHide() { clearInterval(this._timer) }, onUnload() { clearInterval(this._timer) },
  async load() {
    try {
      await getApp().ready()
      const [config, user] = await Promise.all([api.request('/api/config'), api.request('/api/me')])
      this._offset = user.serverTime - Date.now(); this.setData({ user, config, error: '' }); this.tick()
    } catch (e) { this.setData({ error: e.message }); api.toast(e) }
  },
  tick() {
    const user = this.data.user, now = Date.now() + (this._offset || 0)
    const remaining = Math.max(0, Math.ceil(((user.nextChestAt || now) - now) / 1000)), max = this.data.config.chestCooldownSeconds || 120
    this.setData({ remaining, timer: String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0'), progress: Math.min(100, Math.max(0, (max - remaining) / max * 100)), bagRemaining: Math.max(0, Math.ceil(((user.nextBagAt || now) - now) / 1000)) })
  },
  async claim(e) { if (this.data.busy) return; this.setData({ busy: true }); try { const result = await api.claim(e.currentTarget.dataset.kind); if (result) wx.showToast({ title: '演示金币已入账' }); await this.load() } catch (error) { api.toast(error) } finally { this.setData({ busy: false }) } },
  async skip() { try { await api.request('/api/dev/ready', 'POST', {}); await this.load() } catch (error) { api.toast(error) } }
})
