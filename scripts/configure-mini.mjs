import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  constants,
} from "node:fs";
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--api", "--dev-api", "--appid"].includes(args[i]) || !args[i + 1])
    throw new Error(
      "用法：npm run configure:mini -- --api https://域名 --appid 企业AppID；可选--dev-api http://局域网IP:端口",
    );
  options[args[i]] = args[i + 1];
}
if (!args.length)
  throw new Error("请提供--api、--dev-api或--appid；不接收微信密钥");
const file = "miniprogram/config.js",
  source = readFileSync(file, "utf8");
if (!source.includes("CONFIG_GENERATOR_V1"))
  throw new Error("检测到自定义配置，请手动编辑，工具不会覆盖");
const origin = (value, dev = false) => {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (!dev && url.protocol !== "https:") ||
    (dev && !["http:", "https:"].includes(url.protocol))
  )
    throw new Error("接口需无账号密码、路径或参数的源站，正式接口必须HTTPS");
  return url.origin;
};
let next = source;
if (options["--api"])
  next = next.replace(
    /const RELEASE_API_BASE = "[^"]*";/,
    "const RELEASE_API_BASE = " +
      JSON.stringify(origin(options["--api"])) +
      ";",
  );
if (options["--api"] && !options["--dev-api"])
  next = next.replace(
    /const DEV_API_BASE = "[^"]*";/,
    "const DEV_API_BASE = " + JSON.stringify(origin(options["--api"])) + ";",
  );
if (options["--dev-api"])
  next = next.replace(
    /const DEV_API_BASE = "[^"]*";/,
    "const DEV_API_BASE = " +
      JSON.stringify(origin(options["--dev-api"], true)) +
      ";",
  );
const projectFile = "miniprogram/project.config.json",
  project = JSON.parse(readFileSync(projectFile, "utf8"));
if (options["--appid"]) {
  if (!/^wx[A-Za-z0-9]{16}$/.test(options["--appid"]))
    throw new Error("AppID格式应为wx加16位字符；请使用自己的企业AppID");
  project.appid = options["--appid"];
}
if (options["--api"]) project.setting.urlCheck = true;
for (const p of [file, projectFile])
  if (!existsSync(p + ".user.bak"))
    copyFileSync(p, p + ".user.bak", constants.COPYFILE_EXCL);
writeFileSync(file, next);
writeFileSync(projectFile, JSON.stringify(project, null, 2) + "\n");
console.log(
  "小程序公开配置已更新，首次原文件已备份为.user.bak；未验证AppID、域名权限或真实微信登录。",
);
