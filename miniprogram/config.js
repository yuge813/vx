// CONFIG_GENERATOR_V1 — 可用 npm run configure:mini 设置公开API地址与AppID，不存放密钥。
const DEV_API_BASE = "http://127.0.0.1:8792";
const RELEASE_API_BASE = "";
let ENV_VERSION = "develop";
try {
  if (typeof wx.getAccountInfoSync === "function")
    ENV_VERSION = wx.getAccountInfoSync().miniProgram.envVersion;
} catch (_) {}
const release = ENV_VERSION === "release" || ENV_VERSION === "trial";
module.exports = {
  API_BASE: release ? RELEASE_API_BASE : DEV_API_BASE,
  ENV_VERSION,
  CONFIG_ERROR:
    release && !/^https:\/\//.test(RELEASE_API_BASE)
      ? "未配置正式HTTPS接口，请先配置再打包；禁止连接本机演示服务"
      : "",
};
