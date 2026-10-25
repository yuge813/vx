import { existsSync, readFileSync } from "node:fs";
import { runtimeConfig } from "../server/runtime-config.mjs";
const issues = [],
  warnings = [];
if (Number(process.versions.node.split(".")[0]) < 24)
  issues.push("需要Node.js 24+");
let config;
try {
  config = runtimeConfig();
} catch (e) {
  issues.push(e.message);
}
for (const file of [
  "miniprogram/app.json",
  "miniprogram/services/client.js",
  "web/index.html",
])
  if (!existsSync(file)) issues.push("缺少" + file);
if (config) {
  console.log(
    "配置模式：" +
      config.mode +
      "；本机端口：" +
      config.port +
      "；管理员令牌已设置（不输出）",
  );
  if (config.development)
    warnings.push("内部开发模式，模拟金币不可兑现，不可直接公开经营");
  const project = JSON.parse(
    readFileSync("miniprogram/project.config.json", "utf8"),
  );
  if (project.appid === "touristappid")
    warnings.push("原生AppID仍为游客配置，微信登录与真机需企业AppID");
}
warnings.push(
  "真实广告单元、现金激励适用规则、微信零钱付款未接入；环境检查不等于上线许可",
);
for (const warning of warnings) console.log("待审核：" + warning);
for (const issue of issues) console.error("失败：" + issue);
if (issues.length) process.exitCode = 1;
else console.log("本机开发环境检查通过；商业上线仍受上述门槛限制。");
