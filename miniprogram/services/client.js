const { API_BASE } = require('../config')
let token = wx.getStorageSync('xingxiang_token') || ''
let config = null
function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => wx.request({
    url: API_BASE + path, method, data,
    header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    timeout: 12000,
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) { if (path === '/api/config') config = res.data; return resolve(res.data) }
      if (res.statusCode === 401) { token = ''; wx.removeStorageSync('xingxiang_token'); getApp()._ready = null }
      const error = new Error(res.data && res.data.error ? res.data.error.message : '请求失败')
      error.status = res.statusCode; reject(error)
    },
    fail() { reject(new Error('连接失败，请检查后端和网络；可重新查询原任务')) }
  }))
}
async function initialize() {
  config = await request('/api/config')
  if (token) {
    try { await request('/api/me'); return config } catch (error) { if (error.status !== 401) throw error }
  }
  let reply
  if (config.mode === 'development') {
    let installationId = wx.getStorageSync('xingxiang_installation')
    if (!installationId) { installationId = 'wxdev_' + Date.now() + '_' + Math.random().toString(36).slice(2); wx.setStorageSync('xingxiang_installation', installationId) }
    reply = await request('/api/auth/demo', 'POST', { installationId })
  } else {
    const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
    reply = await request('/api/auth/wechat', 'POST', { code: login.code })
  }
  token = reply.token; wx.setStorageSync('xingxiang_token', token)
  return config
}
function modal(options) { return new Promise((resolve, reject) => wx.showModal({ ...options, success: resolve, fail: reject })) }
async function claim(kind) {
  await getApp().ready()
  if (config.adProvider !== 'demo') throw new Error('真实广告尚未接入，该功能暂不可用')
  let task, saved = wx.getStorageSync('xingxiang_pending_task')
  if (saved) {
    try {
      task = await request('/api/tasks/' + saved)
      if (task.state === 'rewarded') { wx.removeStorageSync('xingxiang_pending_task'); return { recovered: true, task } }
      if (task.state !== 'pending') { task = null; wx.removeStorageSync('xingxiang_pending_task') }
    } catch (error) { if (error.status !== 404) throw error; wx.removeStorageSync('xingxiang_pending_task') }
  }
  if (!task) { task = await request('/api/tasks', 'POST', { kind }); wx.setStorageSync('xingxiang_pending_task', task.id) }
  const answer = await modal({ title: '开发演示 · 不播放真实广告', content: '完成3秒演示将获得' + task.total + '演示金币（基础' + task.base + '＋补贴' + task.subsidy + '）。金币不可兑现。', confirmText: '开始演示', cancelText: '取消任务' })
  if (!answer.confirm) { await request('/api/tasks/' + task.id + '/cancel', 'POST', {}); wx.removeStorageSync('xingxiang_pending_task'); return null }
  wx.showLoading({ title: '模拟流程进行中', mask: true })
  try {
    await new Promise(resolve => setTimeout(resolve, 3100))
    const result = await request('/api/tasks/' + task.id + '/complete', 'POST', {})
    wx.removeStorageSync('xingxiang_pending_task'); return result
  } finally { wx.hideLoading() }
}
function money(coins) { return ((coins || 0) / ((config && config.coinsPerYuan) || 1000)).toFixed(2) }
function time(ms) { return new Date(ms).toLocaleString('zh-CN', { hour12: false }) }
function toast(error) { wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 3000 }) }
module.exports = { initialize, request, claim, money, time, toast, getConfig: () => config }
