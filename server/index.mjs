import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Store, AppError } from "./store.mjs";
import { YuanxiangStore } from "./yuanxiang.mjs";
import { runtimeConfig } from "./runtime-config.mjs";
import { routePlay } from "./play-routes.mjs";

const publicRoot = fileURLToPath(new URL("../web/", import.meta.url));
const fail = (message, status = 400, code) => {
  throw new AppError(message, status, code);
};
async function body(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json"))
    fail("请使用 application/json", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) fail("请求内容过大", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object")
      fail("请求格式错误");
    return value;
  } catch (e) {
    if (e instanceof AppError) throw e;
    fail("JSON 格式错误");
  }
}
function sameSecret(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({
  store = new Store(),
  adminToken = "",
  wxAppId = "",
  wxAppSecret = "",
  fetcher = fetch,
  publicOrigin = "",
  extension = null,
} = {}) {
  if (
    publicOrigin &&
    (new URL(publicOrigin).origin !== publicOrigin ||
      !["http:", "https:"].includes(new URL(publicOrigin).protocol))
  )
    throw new Error("PUBLIC_ORIGIN必须是HTTP或HTTPS源站，不带路径或末尾斜线");
  const limits = new Map();
  const takeLimit = (key, limit, res) => {
    const now = Date.now();
    let bucket = limits.get(key);
    if (!bucket || now > bucket.until) {
      bucket = { n: 0, until: now + 60000 };
      limits.set(key, bucket);
    }
    if (++bucket.n > limit) {
      res.setHeader("Retry-After", "60");
      fail("请求过于频繁，请稍后再试", 429);
    }
  };
  let lastSweep = 0;
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname;
      if (path.startsWith("/api/")) {
        const now = Date.now();
        if (now - lastSweep > 60000) {
          for (const [key, value] of limits)
            if (now > value.until) limits.delete(key);
          lastSweep = now;
        }
        const group = path.startsWith("/api/auth/") ? "auth" : "api";
        const key = `${req.socket.remoteAddress}:${group}`,
          limit = group === "auth" ? 30 : 2000;
        let bucket = limits.get(key);
        if (!bucket || now > bucket.until) {
          bucket = { n: 0, until: now + 60000 };
          limits.set(key, bucket);
        }
        if (++bucket.n > limit) {
          res.setHeader("Retry-After", "60");
          fail("请求过于频繁，请稍后再试", 429);
        }
        if (req.headers.origin) {
          const expected =
            publicOrigin ||
            `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
          if (req.headers.origin !== expected) fail("不允许跨站请求", 403);
        }
        if (req.method === "GET" && path === "/api/health")
          return send(200, {
            ok: true,
            mode: store.development ? "development" : "production",
            realAds: false,
            realPayments: false,
          });
        if (req.method === "GET" && path === "/api/config")
          return send(200, store.publicConfig());
        if (req.method === "POST" && path === "/api/auth/demo") {
          const data = await body(req);
          return send(200, store.login(data.installationId, true));
        }
        if (req.method === "POST" && path === "/api/auth/wechat") {
          const data = await body(req);
          if (!wxAppId || !wxAppSecret)
            fail(
              "尚未配置微信登录凭据，请使用开发模式",
              503,
              "WECHAT_NOT_CONFIGURED",
            );
          if (
            typeof data.code !== "string" ||
            !data.code ||
            data.code.length > 256
          )
            fail("缺少有效登录凭证");
          let payload;
          try {
            const upstream = new URL(
              "https://api.weixin.qq.com/sns/jscode2session",
            );
            upstream.search = new URLSearchParams({
              appid: wxAppId,
              secret: wxAppSecret,
              js_code: data.code,
              grant_type: "authorization_code",
            });
            const reply = await fetcher(upstream, {
              signal: AbortSignal.timeout(10000),
            });
            if (!reply.ok) fail("微信登录服务暂不可用", 502);
            payload = await reply.json();
          } catch {
            fail("微信登录服务暂不可用，请稍后再试", 502);
          }
          if (
            payload.errcode ||
            typeof payload.openid !== "string" ||
            !payload.openid
          )
            fail("微信登录凭证无效，请重试", 401);
          // session_key 仅存在于该次服务器响应中，不写入客户端、日志或公开资料。
          return send(200, store.login(`wx:${payload.openid}`, false));
        }
        const token = String(req.headers.authorization || "").replace(
          /^Bearer /,
          "",
        );
        if (path.startsWith("/api/admin/")) {
          if (adminToken.length < 32 || !sameSecret(token, adminToken))
            fail("管理员令牌无效或尚未配置", 401);
          takeLimit("admin:" + req.socket.remoteAddress, 600, res);
          if (
            extension &&
            (await extension({
              req,
              path,
              admin: true,
              send,
              readBody: () => body(req),
              store,
            }))
          )
            return;
          if (req.method === "GET" && path === "/api/admin/overview")
            return send(200, store.adminOverview());
          if (req.method === "PUT" && path === "/api/admin/settings")
            return send(200, store.updateSettings(await body(req)));
          let match;
          if (
            req.method === "POST" &&
            (match = path.match(
              /^\/api\/admin\/withdrawals\/([a-f0-9-]+)\/review$/,
            ))
          ) {
            const data = await body(req);
            return send(
              200,
              store.reviewWithdrawal(match[1], data.action, data.reason),
            );
          }
          if (
            req.method === "PUT" &&
            (match = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/))
          )
            return send(200, store.updateUser(match[1], await body(req)));
          fail("接口不存在", 404);
        }
        const userId = store.authenticate(token);
        takeLimit("user:" + userId, 600, res);
        if (req.method !== "GET") {
          if (req.method === "POST" && path.startsWith("/api/play/games/"))
            takeLimit("play-action:" + userId, 360, res);
          else takeLimit("write:" + userId, 120, res);
        }
        if (
          extension &&
          (await extension({
            req,
            path,
            admin: false,
            userId,
            send,
            readBody: () => body(req),
            store,
          }))
        )
          return;
        if (req.method === "GET" && path === "/api/me")
          return send(200, store.profile(userId));
        if (req.method === "GET" && path === "/api/ledger")
          return send(200, store.ledger(userId));
        if (req.method === "POST" && path === "/api/checkin") {
          await body(req);
          return send(200, store.checkin(userId));
        }
        if (req.method === "POST" && path === "/api/tasks")
          return send(200, store.createTask(userId, (await body(req)).kind));
        let match;
        if (
          (match = path.match(
            /^\/api\/tasks\/([a-f0-9-]+)(?:\/(complete|cancel))?$/,
          ))
        ) {
          if (req.method === "GET" && !match[2])
            return send(200, store.task(userId, match[1]));
          if (req.method === "POST" && match[2]) {
            await body(req);
            return send(
              200,
              match[2] === "complete"
                ? store.completeTask(userId, match[1])
                : store.cancelTask(userId, match[1]),
            );
          }
        }
        if (path === "/api/withdrawals") {
          if (req.method === "GET") return send(200, store.withdrawals(userId));
          if (req.method === "POST") {
            const data = await body(req);
            return send(
              200,
              store.withdraw(userId, data.coins, data.requestKey),
            );
          }
        }
        if (path === "/api/plans") {
          if (req.method === "GET") return send(200, store.plans(userId));
          if (req.method === "POST")
            return send(200, store.addPlan(userId, (await body(req)).title));
        }
        if ((match = path.match(/^\/api\/plans\/([a-f0-9-]+)$/))) {
          if (req.method === "PUT")
            return send(
              200,
              store.changePlan(userId, match[1], (await body(req)).done),
            );
          if (req.method === "DELETE")
            return send(200, store.removePlan(userId, match[1]));
        }
        if (req.method === "POST" && path === "/api/dev/ready") {
          await body(req);
          return send(200, store.demoReady(userId));
        }
        fail("接口不存在", 404);
      }
      if (req.method !== "GET") fail("请求方法不支持", 405);
      const asset =
        path === "/"
          ? "index.html"
          : path === "/admin"
            ? "admin.html"
            : decodeURIComponent(path).replace(/^\/+/, "");
      const file = resolve(publicRoot, asset);
      if (!file.startsWith(resolve(publicRoot) + sep)) fail("路径无效", 403);
      let content;
      try {
        content = await readFile(file);
      } catch {
        fail("页面不存在", 404);
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
    } catch (error) {
      if (!(error instanceof AppError))
        console.error("请求处理异常", requestId, error.name); // 不记录请求体、令牌或上游凭据。
      send(error instanceof AppError ? error.status : 500, {
        error: {
          code: error.code || "INTERNAL_ERROR",
          message:
            error instanceof AppError
              ? error.message
              : "服务暂不可用，请稍后再试",
        },
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store };
}

export async function yuanxiangRoutes({
  req,
  path,
  admin,
  userId,
  send,
  readBody,
  store,
}) {
  if (await routePlay({ req, path, admin, userId, send, readBody, store }))
    return true;
  let match;
  if (admin) {
    const query = new URL(req.url, "http://localhost").searchParams;
    if (req.method === "GET" && path === "/api/admin/users") {
      send(
        200,
        store.operations.users(
          query.get("q") || "",
          Number(query.get("page") || 1),
        ),
      );
      return true;
    }
    if (
      req.method === "GET" &&
      (match = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/detail$/))
    ) {
      send(200, store.operations.userDetail(match[1]));
      return true;
    }
    if (req.method === "GET" && path === "/api/admin/report") {
      send(200, store.operations.report(Number(query.get("days") || 7)));
      return true;
    }
    if (req.method === "GET" && path === "/api/admin/reconciliation") {
      send(200, store.operations.reconcile());
      return true;
    }
    if (req.method === "POST" && path === "/api/admin/business-entries") {
      send(200, store.operations.addBusiness(await readBody()));
      return true;
    }
    if (
      req.method === "POST" &&
      (match = path.match(
        /^\/api\/admin\/business-entries\/([a-f0-9-]+)\/void$/,
      ))
    ) {
      send(
        200,
        store.operations.voidBusiness(match[1], (await readBody()).reason),
      );
      return true;
    }
    if (req.method === "GET" && path === "/api/admin/closures") {
      send(200, store.operations.closureList());
      return true;
    }
    if (
      req.method === "POST" &&
      (match = path.match(/^\/api\/admin\/closures\/([a-f0-9-]+)\/review$/))
    ) {
      const data = await readBody();
      send(
        200,
        store.operations.reviewClosure(match[1], data.action, data.reason),
      );
      return true;
    }
    if (req.method === "GET" && path === "/api/admin/room-content") {
      send(200, store.roomContent.admin());
      return true;
    }
    if (
      (match = path.match(
        /^\/api\/admin\/room\/(actors|messages)(?:\/([a-f0-9-]+))?$/,
      ))
    ) {
      const [, type, id] = match;
      if ((req.method === "POST" && !id) || (req.method === "PUT" && id)) {
        const data = await readBody();
        send(
          200,
          type === "actors"
            ? store.roomContent.saveActor(id, data)
            : store.roomContent.saveMessage(id, data),
        );
        return true;
      }
      if (req.method === "DELETE" && id) {
        send(
          200,
          store.roomContent.remove(
            type === "actors" ? "actor" : "message",
            id,
            await readBody(),
          ),
        );
        return true;
      }
    }
    if (
      req.method === "POST" &&
      (match = path.match(/^\/api\/admin\/support\/([a-f0-9-]+)\/reply$/))
    ) {
      send(200, store.replySupport(match[1], (await readBody()).reply));
      return true;
    }
    return false;
  }
  if (req.method === "POST" && path === "/api/auth/logout") {
    const data = await readBody();
    send(
      200,
      store.operations.logout(
        userId,
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
        data.all === true,
      ),
    );
    return true;
  }
  if (req.method === "PUT" && path === "/api/profile") {
    send(200, store.operations.rename(userId, (await readBody()).name));
    return true;
  }
  if (req.method === "GET" && path === "/api/account/export") {
    send(200, store.operations.exportData(userId));
    return true;
  }
  if (req.method === "POST" && path === "/api/account/closure") {
    send(200, store.operations.requestClosure(userId, await readBody()));
    return true;
  }
  if (req.method === "GET" && path === "/api/history") {
    const query = new URL(req.url, "http://localhost").searchParams;
    send(
      200,
      store.operations.history(
        userId,
        query.get("type") || "ledger",
        query.get("cursor") || "",
      ),
    );
    return true;
  }
  if (path.startsWith("/api/plans")) {
    send(404, {
      error: { code: "NOT_FOUND", message: "金币版本不提供清单功能" },
    });
    return true;
  }
  if (req.method === "GET" && path === "/api/group") {
    const active =
      new URL(req.url, "http://localhost").searchParams.get("active") === "1";
    send(200, store.group(userId, { roomActive: active }));
    return true;
  }
  if (req.method === "POST" && path === "/api/group/presence") {
    const data = await readBody();
    if (data.active !== false) fail("仅支持暂停群消息计时", 400);
    send(200, store.roomContent.pause(userId));
    return true;
  }
  if (req.method === "POST" && path === "/api/group/skip") {
    send(200, store.skip(userId, (await readBody()).kind));
    return true;
  }
  if (req.method === "GET" && path === "/api/referral") {
    send(200, store.referral(userId));
    return true;
  }
  if (req.method === "POST" && path === "/api/referral/bind") {
    send(200, store.bindReferral(userId, (await readBody()).code));
    return true;
  }
  if (path === "/api/support") {
    if (req.method === "GET") {
      send(200, store.supportList(userId));
      return true;
    }
    if (req.method === "POST") {
      send(200, store.support(userId, (await readBody()).message));
      return true;
    }
  }
  return false;
}

export function createYuanxiangApp(options = {}) {
  return createApp({
    ...options,
    store: options.store || new YuanxiangStore(),
    extension: yuanxiangRoutes,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let settings;
  try {
    settings = runtimeConfig();
  } catch (e) {
    console.error("配置检查失败：" + e.message);
    process.exit(1);
  }
  const {
    development,
    provider,
    path,
    adminToken,
    wxAppId,
    wxAppSecret,
    publicOrigin,
    port,
    host,
    operator,
  } = settings;
  const store = new YuanxiangStore({
    path,
    development,
    adProvider: provider,
    operator,
  });
  const { server } = createYuanxiangApp({
    store,
    adminToken,
    wxAppId,
    wxAppSecret,
    publicOrigin,
  });
  server.once("error", (error) => {
    console.error(
      "启动失败：" +
        (error.code === "EADDRINUSE"
          ? `端口${port}已占用，请关闭自己启动的旧服务或设置其他PORT`
          : error.code || error.name),
    );
    store.close();
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `悦享金币已启动，监听 ${host}:${port}；签到/红包群/福袋/金币钱包；真实广告与转账未接入。`,
    ),
  );
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.closeIdleConnections();
    const deadline = setTimeout(() => {
      server.closeAllConnections();
    }, 5000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
