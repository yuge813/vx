const api = require('../../services/client')
Page({
  data: { user: {}, config: {}, error: '' },
  onShow() { this.load() },
  async load() { try { await getApp().ready(); const [config, user] = await Promise.all([api.request('/api/config'), api.request('/api/me')]); this.setData({ user, config, shortId: user.id.slice(0, 8), error: '' }) } catch (error) { this.setData({ error: error.message }); api.toast(error) } },
  records() { wx.navigateTo({ url: '/pages/records/index' }) },
  async resume() { try { await api.claim('bag'); await this.load() } catch (error) { api.toast(error) } },
  rules() { wx.showModal({ title: '开发版奖励说明', content: '签到、宝箱和固定福袋均为演示。金币不可兑现。基础奖励与补贴分别记账。宝箱120秒、福袋60秒冷却，每日次数以后台规则为准。没有随机中奖、无限叠包和邀请返佣。', showCancel: false }) },
  privacy() { wx.showModal({ title: '开发版数据说明', content: '本地保存会话令牌、演示安装标识和未完成请求编号。后端保存演示账户、计划、奖励与申请记录，不读取通讯录、位置或剪贴板。正式发布前需补充运营主体、实际隐私指引、数据保留及注销流程。', showCancel: false }) },
  support() { wx.showModal({ title: '客服与申诉尚待配置', content: '开发版不提供真实客服渠道。正式运营需配置企业客服及申诉处理流程。反馈时可提供用户编号：' + this.data.user.id + '，请勿发送密码或密钥。', showCancel: false }) }
})
