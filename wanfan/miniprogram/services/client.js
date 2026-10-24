const { API_BASE } = require("../config");
let token = wx.getStorageSync("wanfan_token") || "",
  config = null;
function request(path, method = "GET", data) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: API_BASE + "/api" + path,
      method,
      data,
      timeout: 12000,
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300)
          return resolve(res.data);
        if (res.statusCode === 401) {
          token = "";
          wx.removeStorageSync("wanfan_token");
          getApp()._ready = null;
        }
        const e = new Error(
          res.data && res.data.error ? res.data.error.message : "请求失败",
        );
        e.status = res.statusCode;
        reject(e);
      },
      fail() {
        reject(new Error("连接失败，请检查后端；重复提交原菜单不会重复记录。"));
      },
    }),
  );
}
async function initialize() {
  config = await request("/config");
  if (token)
    try {
      await request("/me");
      return config;
    } catch (e) {
      if (e.status !== 401) throw e;
    }
  let reply;
  if (config.mode === "development") {
    let installationId = wx.getStorageSync("wanfan_installation");
    if (!installationId) {
      installationId =
        "dinner_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      wx.setStorageSync("wanfan_installation", installationId);
    }
    reply = await request("/auth/demo", "POST", { installationId });
  } else {
    const login = await new Promise((resolve, reject) =>
      wx.login({ success: resolve, fail: reject }),
    );
    reply = await request("/auth/wechat", "POST", { code: login.code });
  }
  token = reply.token;
  wx.setStorageSync("wanfan_token", token);
  return config;
}
async function dashboard() {
  await getApp().ready();
  return request("/dashboard");
}
function toast(e) {
  wx.showToast({
    title: e.message || "操作失败",
    icon: "none",
    duration: 3000,
  });
}
const modal = (options) =>
  new Promise((resolve, reject) =>
    wx.showModal({ ...options, success: resolve, fail: reject }),
  );
function logoutLocal() {
  token = "";
  wx.removeStorageSync("wanfan_token");
  wx.removeStorageSync("wanfan_installation");
  getApp()._ready = null;
}
module.exports = { initialize, request, dashboard, toast, modal, logoutLocal };
