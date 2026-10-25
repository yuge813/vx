import { resolve } from "node:path";
export function runtimeConfig(env = process.env) {
  const mode = env.APP_ENV || "development",
    provider =
      env.AD_PROVIDER || (mode === "development" ? "demo" : "disabled");
  if (!["development", "production"].includes(mode))
    throw new Error("APP_ENV只能为development或production");
  if (
    !["demo", "disabled"].includes(provider) ||
    (mode === "production" && provider !== "disabled")
  )
    throw new Error("仅支持demo/disabled；正式模式禁止模拟广告");
  const port = Number(env.PORT || 8792);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT需1—65535");
  const origin = env.PUBLIC_ORIGIN || "";
  if (origin) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
      throw new Error("PUBLIC_ORIGIN需完整源站，不带路径或尾斜线");
  }
  const adminToken = env.ADMIN_TOKEN || "";
  if (adminToken.length < 32)
    throw new Error("ADMIN_TOKEN至少32字符，请先npm run setup");
  if (mode === "production") {
    if (!origin.startsWith("https://"))
      throw new Error("正式模式需要HTTPS PUBLIC_ORIGIN");
    for (const key of [
      "WX_APP_ID",
      "WX_APP_SECRET",
      "OPERATOR_NAME",
      "SUPPORT_CONTACT",
      "PRIVACY_URL",
    ])
      if (!env[key] || env[key] === "touristappid")
        throw new Error("正式模式缺少" + key);
    if (!env.PRIVACY_URL.startsWith("https://"))
      throw new Error("正式隐私声明需HTTPS网址");
  }
  return {
    mode,
    development: mode === "development",
    provider,
    port,
    host: env.HOST || "127.0.0.1",
    path: resolve(env.DB_PATH || "./data/yuanxiang.sqlite"),
    adminToken,
    wxAppId: env.WX_APP_ID || "",
    wxAppSecret: env.WX_APP_SECRET || "",
    publicOrigin: origin,
    operator: {
      name: env.OPERATOR_NAME || "待配置运营主体",
      contact: env.SUPPORT_CONTACT || "内部后台反馈，正式企业客服未配置",
      privacyURL: env.PRIVACY_URL || "",
    },
  };
}
