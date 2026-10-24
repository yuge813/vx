import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { DinnerStore, ErrorResponse } from "./store.mjs";
const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const error = (s, status = 400, code) => {
  throw new ErrorResponse(s, status, code);
};
const equal = (a, b) =>
  !!a &&
  !!b &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json"))
    error("请使用JSON请求", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) error("请求内容过大", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object")
      error("请求应为JSON对象");
    return value;
  } catch (e) {
    if (e instanceof ErrorResponse) throw e;
    error("JSON格式错误");
  }
}
export function createDinnerApp({
  store = new DinnerStore(),
  adminToken = "",
  publicOrigin = "",
  wxAppId = "",
  wxAppSecret = "",
  fetcher = fetch,
} = {}) {
  if (publicOrigin) {
    const origin = new URL(publicOrigin);
    if (
      origin.origin !== publicOrigin ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new Error(
        "PUBLIC_ORIGIN必须是完整源站，例如https://dinner.example.com，不带路径或尾斜线",
      );
  }
  const rate = new Map();
  let lastCleanup = 0;
  const server = createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname;
      if (path.startsWith("/api/")) {
        const now = Date.now();
        if (now - lastCleanup > 60000) {
          for (const [k, b] of rate) if (b.until < now) rate.delete(k);
          lastCleanup = now;
        }
        const key =
          req.socket.remoteAddress +
          ":" +
          (path.startsWith("/api/auth/") ? "auth" : "api");
        let bucket = rate.get(key);
        if (!bucket || bucket.until < now) {
          bucket = { count: 0, until: now + 60000 };
          rate.set(key, bucket);
        }
        if (++bucket.count > (path.startsWith("/api/auth/") ? 30 : 600)) {
          res.setHeader("Retry-After", "60");
          error("请求过于频繁", 429);
        }
        if (
          req.headers.origin &&
          req.headers.origin !==
            (publicOrigin ||
              `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`)
        )
          error("不允许跨站请求", 403);
        if (req.method === "GET" && path === "/api/health")
          return send(200, {
            ok: true,
            product: "wanfan",
            realAds: false,
            realPayments: false,
          });
        if (req.method === "GET" && path === "/api/config")
          return send(200, store.config());
        if (req.method === "POST" && path === "/api/auth/demo")
          return send(200, store.login((await body(req)).installationId));
        if (req.method === "POST" && path === "/api/auth/wechat") {
          const data = await body(req);
          if (!wxAppId || !wxAppSecret) error("尚未配置微信登录", 503);
          if (
            typeof data.code !== "string" ||
            data.code.length < 1 ||
            data.code.length > 256
          )
            error("微信登录凭证无效");
          let upstream;
          try {
            const target = new URL(
              "https://api.weixin.qq.com/sns/jscode2session",
            );
            target.search = new URLSearchParams({
              appid: wxAppId,
              secret: wxAppSecret,
              js_code: data.code,
              grant_type: "authorization_code",
            });
            const r = await fetcher(target, {
              signal: AbortSignal.timeout(10000),
            });
            if (!r.ok) throw new Error();
            upstream = await r.json();
          } catch {
            error("微信登录服务暂不可用", 502);
          }
          if (
            upstream.errcode ||
            typeof upstream.openid !== "string" ||
            !upstream.openid
          )
            error("登录凭证无效，请重试", 401);
          return send(200, store.login("wx:" + upstream.openid, false));
        }
        const token = String(req.headers.authorization || "").replace(
          /^Bearer /,
          "",
        );
        let match;
        if (path.startsWith("/api/admin/")) {
          if (adminToken.length < 32 || !equal(token, adminToken))
            error("管理员令牌无效或尚未配置", 401);
          if (req.method === "GET" && path === "/api/admin/overview")
            return send(200, store.overview());
          if (
            req.method === "POST" &&
            (match = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/grant$/))
          ) {
            await body(req);
            return send(200, store.grant(match[1]));
          }
          if (
            req.method === "PUT" &&
            (match = path.match(/^\/api\/admin\/recipes\/([a-z-]+)$/))
          )
            return send(
              200,
              store.setRecipe(match[1], (await body(req)).active),
            );
          if (
            req.method === "POST" &&
            (match = path.match(
              /^\/api\/admin\/feedback\/([a-f0-9-]+)\/reply$/,
            ))
          )
            return send(200, store.reply(match[1], (await body(req)).reply));
          error("接口不存在", 404);
        }
        const u = store.auth(token);
        store.event(u, "visit");
        if (req.method === "GET" && path === "/api/dashboard")
          return send(200, store.dashboard(u));
        if (req.method === "GET" && path === "/api/me")
          return send(200, store.profile(u));
        if (req.method === "PUT" && path === "/api/preferences")
          return send(200, store.preferences(u, await body(req)));
        if (req.method === "POST" && path === "/api/recommendations/rotate") {
          await body(req);
          return send(200, store.rotate(u));
        }
        if (
          req.method === "GET" &&
          (match = path.match(/^\/api\/recipes\/([a-z-]+)$/))
        )
          return send(200, store.recipe(u, match[1]));
        if (
          req.method === "PUT" &&
          (match = path.match(/^\/api\/recipes\/([a-z-]+)\/favorite$/))
        )
          return send(
            200,
            store.favorite(u, match[1], (await body(req)).favorite),
          );
        if (path === "/api/pantry") {
          if (req.method === "GET") return send(200, store.pantry(u));
          if (req.method === "PUT")
            return send(200, store.putPantry(u, await body(req)));
        }
        if (
          req.method === "DELETE" &&
          (match = path.match(/^\/api\/pantry\/([a-z-]+)$/))
        )
          return send(200, store.removePantry(u, match[1]));
        if (req.method === "POST" && path === "/api/plans")
          return send(200, store.plan(u, await body(req)));
        if (
          req.method === "DELETE" &&
          (match = path.match(/^\/api\/plans\/([a-f0-9-]+)$/))
        )
          return send(200, store.removePlan(u, match[1]));
        if (
          req.method === "POST" &&
          (match = path.match(/^\/api\/plans\/([a-f0-9-]+)\/complete$/))
        ) {
          await body(req);
          return send(200, store.complete(u, match[1]));
        }
        if (req.method === "GET" && path === "/api/shopping")
          return send(200, store.shopping(u));
        if (
          req.method === "PUT" &&
          (match = path.match(/^\/api\/shopping\/([a-z-]+)$/))
        )
          return send(
            200,
            store.purchase(u, match[1], (await body(req)).checked),
          );
        if (req.method === "POST" && path === "/api/checkin") {
          await body(req);
          return send(200, store.checkin(u));
        }
        if (req.method === "GET" && path === "/api/journal")
          return send(200, store.journal(u));
        if (req.method === "GET" && path === "/api/week")
          return send(200, store.latestWeek(u));
        if (req.method === "POST" && path === "/api/week/generate") {
          await body(req);
          return send(200, store.generateWeek(u));
        }
        if (req.method === "POST" && path === "/api/feedback")
          return send(200, store.feedback(u, (await body(req)).message));
        if (req.method === "DELETE" && path === "/api/account") {
          const data = await body(req);
          if (data.confirm !== "DELETE") error("需要明确确认删除");
          return send(200, store.deleteAccount(u));
        }
        if (
          path.startsWith("/api/rewards") ||
          path.startsWith("/api/withdrawals")
        )
          error("广告奖励和现金功能未开放", 503, "CAPABILITY_DISABLED");
        error("接口不存在", 404);
      }
      if (req.method !== "GET") error("请求方法不支持", 405);
      const relative =
          path === "/"
            ? "index.html"
            : path === "/admin"
              ? "admin.html"
              : decodeURIComponent(path).replace(/^\/+/, ""),
        file = resolve(webRoot, relative);
      if (!file.startsWith(resolve(webRoot) + sep)) error("文件路径无效", 403);
      let content;
      try {
        content = await readFile(file);
      } catch {
        error("页面不存在", 404);
      }
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
        }[extname(file)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
    } catch (e) {
      if (!(e instanceof ErrorResponse))
        console.error("晚饭服务内部异常", e.name);
      send(e instanceof ErrorResponse ? e.status : 500, {
        error: {
          code: e.code || "INTERNAL_ERROR",
          message:
            e instanceof ErrorResponse ? e.message : "服务暂不可用，请稍后重试",
        },
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const env = process.env.APP_ENV || "development";
  if (!["development", "production"].includes(env))
    throw new Error("APP_ENV仅支持development/production");
  const store = new DinnerStore({
    path: process.env.DB_PATH || "./data/wanfan.sqlite",
    development: env === "development",
  });
  const { server } = createDinnerApp({
    store,
    adminToken: process.env.ADMIN_TOKEN || "",
    publicOrigin: process.env.PUBLIC_ORIGIN || "",
    wxAppId: process.env.WX_APP_ID || "",
    wxAppSecret: process.env.WX_APP_SECRET || "",
  });
  server.listen(
    Number(process.env.PORT || 8790),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        "晚饭有谱已启动；端口" +
          (process.env.PORT || 8790) +
          "；真实广告和支付关闭。",
      ),
  );
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
