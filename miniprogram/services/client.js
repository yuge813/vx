const { API_BASE, CONFIG_ERROR, ENV_VERSION } = require("../config");
let token = wx.getStorageSync("yx_token") || "",
  config = null;
function requestOnce(path, method = "GET", data) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      timeout: 12000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (path === "/api/config") config = res.data;
          return resolve(res.data);
        }
        if (res.statusCode === 401) {
          token = "";
          wx.removeStorageSync("yx_token");
          getApp()._ready = null;
        }
        const e = new Error(
          res.data && res.data.error ? res.data.error.message : "请求失败",
        );
        e.status = res.statusCode;
        reject(e);
      },
      fail() {
        const e = new Error("连接失败，请重新查询原任务或原订单");
        e.retryable = true;
        reject(e);
      },
    }),
  );
}
async function request(path, method = "GET", data) {
  try {
    return await requestOnce(path, method, data);
  } catch (e) {
    if (method !== "GET" || !e.retryable) throw e;
    await new Promise((r) => setTimeout(r, 250));
    return requestOnce(path, method, data);
  }
}
async function logout(all = false) {
  await request("/api/auth/logout", "POST", { all });
  token = "";
  config = null;
  for (const key of ["yx_token", "yx_pending_task", "yx_pending_withdrawal"])
    wx.removeStorageSync(key);
  getApp()._ready = null;
}
let activeClaim = null;
function claim(kind) {
  if (activeClaim)
    return activeClaim.kind === kind
      ? activeClaim.promise
      : Promise.reject(new Error("请先完成或恢复当前奖励任务"));
  const promise = claimOnce(kind).finally(() => {
    activeClaim = null;
  });
  activeClaim = { kind, promise };
  return promise;
}
async function initialize() {
  if (CONFIG_ERROR) throw new Error(CONFIG_ERROR);
  config = await request("/api/config");
  if (
    (ENV_VERSION === "release" || ENV_VERSION === "trial") &&
    config.mode !== "production"
  )
    throw new Error("体验版和正式版不能连接开发演示后端");
  if (token)
    try {
      await request("/api/me");
      return config;
    } catch (e) {
      if (e.status !== 401) throw e;
    }
  let reply;
  if (config.mode === "development") {
    let installationId = wx.getStorageSync("yx_installation");
    if (!installationId) {
      installationId =
        "yx_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      wx.setStorageSync("yx_installation", installationId);
    }
    reply = await request("/api/auth/demo", "POST", { installationId });
  } else {
    const result = await new Promise((resolve, reject) =>
      wx.login({ success: resolve, fail: reject }),
    );
    reply = await request("/api/auth/wechat", "POST", { code: result.code });
  }
  token = reply.token;
  wx.setStorageSync("yx_token", token);
  return config;
}
const modal = (options) =>
  new Promise((resolve, reject) =>
    wx.showModal({ ...options, success: resolve, fail: reject }),
  );
async function claimOnce(kind) {
  await getApp().ready();
  config = await request("/api/config");
  if (config.adProvider !== "demo") throw new Error("真实广告及验证尚未接入");
  let task,
    saved = wx.getStorageSync("yx_pending_task");
  if (!saved) {
    const me = await request("/api/me");
    saved = me.pendingTask && me.pendingTask.id;
  }
  if (saved) {
    try {
      task = await request("/api/tasks/" + saved);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (task && task.state === "rewarded") {
      wx.removeStorageSync("yx_pending_task");
      return { recovered: true, task };
    }
    if (task && task.state !== "pending") {
      task = null;
      wx.removeStorageSync("yx_pending_task");
    }
  }
  if (!task) task = await request("/api/tasks", "POST", { kind });
  wx.setStorageSync("yx_pending_task", task.id);
  const content = task.rewardRange
    ? "福袋基础" +
      task.rewardRange.min +
      "—" +
      task.rewardRange.max +
      "金币，另加补贴" +
      task.subsidy +
      "。结果已在服务端锁定。"
    : "基础" +
      task.base +
      "＋补贴" +
      task.subsidy +
      "，合计" +
      task.total +
      "开发金币。";
  const answer = await modal({
    title: "开发模拟 · 不播放真实广告",
    content: content + "金币不可兑现。",
    confirmText: "开始模拟",
    cancelText: "取消保留",
  });
  if (!answer.confirm) {
    await request("/api/tasks/" + task.id + "/cancel", "POST", {});
    wx.removeStorageSync("yx_pending_task");
    return null;
  }
  wx.showLoading({ title: "3秒联调模拟", mask: true });
  try {
    await new Promise((r) => setTimeout(r, 3100));
    const result = await request(
      "/api/tasks/" + task.id + "/complete",
      "POST",
      {},
    );
    wx.removeStorageSync("yx_pending_task");
    return result;
  } finally {
    wx.hideLoading();
  }
}
const money = (coins) =>
  ((coins || 0) / ((config && config.coinsPerYuan) || 1000)).toFixed(2);
function time(ms) {
  const d = new Date(ms + 8 * 3600000),
    pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "/" +
    pad(d.getUTCMonth() + 1) +
    "/" +
    pad(d.getUTCDate()) +
    " " +
    pad(d.getUTCHours()) +
    ":" +
    pad(d.getUTCMinutes())
  );
}
function toast(e) {
  wx.showToast({
    title: e.message || "操作失败",
    icon: "none",
    duration: 3000,
  });
}
module.exports = {
  initialize,
  request,
  logout,
  claim,
  money,
  time,
  toast,
  modal,
  getConfig: () => config,
};
