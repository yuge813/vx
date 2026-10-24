import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
let n = 0;
for (const file of files("wanfan")) {
  if (/\.(js|mjs)$/.test(file)) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    n++;
  }
  if (file.endsWith(".json")) {
    JSON.parse(readFileSync(file, "utf8"));
    n++;
  }
}
const app = JSON.parse(readFileSync("wanfan/miniprogram/app.json", "utf8"));
for (const page of app.pages) {
  const base = "wanfan/miniprogram/" + page;
  for (const ext of [".js", ".json", ".wxml"])
    assert.ok(existsSync(base + ext), base + ext);
  const w = readFileSync(base + ".wxml", "utf8"),
    js = readFileSync(base + ".js", "utf8");
  assert.doesNotMatch(w, /<(?:div|span|br|script)(?:\s|\/?>)/);
  for (const expr of w.matchAll(/\{\{([^}]+)\}\}/g))
    assert.doesNotMatch(
      expr[1],
      /\.\w+\s*\(/,
      "WXML不支持直接调用JavaScript方法",
    );
  for (const match of w.matchAll(/bind(?:tap|input|change)="(\w+)"/g))
    assert.match(
      js,
      new RegExp("\\b" + match[1] + "\\s*\\("),
      page + "事件未定义",
    );
}
for (const name of [
  "tomato",
  "chicken",
  "green",
  "pepper",
  "noodles",
  "rice",
  "shrimp",
  "soup",
  "potato",
]) {
  const png = readFileSync("wanfan/miniprogram/assets/" + name + ".png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(existsSync("wanfan/web/assets/" + name + ".svg"));
}
console.log(
  `晚饭有谱：${n}个脚本/JSON检查通过，5个原生页面、事件、WXML表达式及9幅PNG资源检查通过。未替代微信开发者工具编译。`,
);
