import { AppError } from "./store.mjs";

// 所有入口先经过index中的用户/管理员鉴权；权限及开发环境再由Play业务层校验。
export async function routePlay({
  req,
  path,
  admin,
  userId,
  send,
  readBody,
  store,
}) {
  const prefix = admin ? "/api/admin/play" : "/api/play";
  if (path !== prefix && !path.startsWith(prefix + "/")) return false;
  const suffix = path.slice(prefix.length),
    query = new URL(req.url, "http://localhost").searchParams;
  let match, result;
  if (admin) {
    if (req.method === "GET" && suffix === "/summary")
      result = store.play.summary();
    else if (req.method === "GET" && suffix === "/questions")
      result = store.play.questions(Object.fromEntries(query));
    else if (req.method === "POST" && suffix === "/questions")
      result = store.play.createQuestion(await readBody());
    else if (
      req.method === "PUT" &&
      (match = suffix.match(/^\/questions\/([A-Za-z0-9_-]+)$/))
    )
      result = store.play.editQuestion(match[1], await readBody());
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/questions\/([A-Za-z0-9_-]+)\/publish$/))
    )
      result = store.play.publishQuestion(match[1], await readBody());
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/questions\/([A-Za-z0-9_-]+)\/disable$/))
    )
      result = store.play.disableQuestion(match[1], await readBody());
    else throw new AppError("趣玩后台接口不存在", 404, "NOT_FOUND");
  } else {
    if (req.method === "GET" && ["", "/overview"].includes(suffix))
      result = store.play.overview(userId);
    else if (req.method === "GET" && suffix === "/quiz")
      result = store.play.quiz(userId);
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/quiz\/([A-Za-z0-9_-]+)\/answer$/))
    )
      result = store.play.answer(userId, match[1], await readBody());
    else if (req.method === "GET" && suffix === "/mistakes")
      result = store.play.mistakes(userId);
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/mistakes\/([A-Za-z0-9_-]+)\/answer$/))
    )
      result = store.play.reviewMistake(userId, match[1], await readBody());
    else if (req.method === "POST" && suffix === "/games")
      result = store.play.startGame(userId, await readBody());
    else if (
      req.method === "GET" &&
      (match = suffix.match(/^\/games\/([A-Za-z0-9_-]+)$/))
    )
      result = store.play.game(userId, match[1]);
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/games\/([A-Za-z0-9_-]+)\/action$/))
    )
      result = store.play.act(userId, match[1], await readBody());
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/games\/([A-Za-z0-9_-]+)\/presence$/))
    )
      result = store.play.presence(userId, match[1], (await readBody()).active);
    else if (
      req.method === "POST" &&
      (match = suffix.match(/^\/games\/([A-Za-z0-9_-]+)\/finish$/))
    )
      result = store.play.finish(userId, match[1], await readBody());
    else throw new AppError("趣玩接口不存在", 404, "NOT_FOUND");
  }
  send(200, result);
  return true;
}
