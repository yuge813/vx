import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(root, entry.name))
      : [join(root, entry.name)],
  );
}
let count = 0;
for (const file of [
  "package.json",
  ...["server", "web", "scripts", "tests", "miniprogram", "shared"].flatMap(
    files,
  ),
]) {
  if (/\.(?:mjs|cjs|js)$/.test(file)) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    count++;
  }
  if (file.endsWith(".json")) {
    JSON.parse(readFileSync(file, "utf8"));
    count++;
  }
}
const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
for (const page of app.pages) {
  for (const extension of [".js", ".json", ".wxml"])
    assert.ok(
      existsSync("miniprogram/" + page + extension),
      `页面缺少文件 ${page + extension}`,
    );
  const xml = readFileSync("miniprogram/" + page + ".wxml", "utf8"),
    js = readFileSync("miniprogram/" + page + ".js", "utf8");
  assert.doesNotMatch(
    xml,
    /<(?:br|div|span|p|script)(?:\s|\/?>)/,
    "WXML不应包含HTML标签",
  );
  for (const match of xml.matchAll(
    /(?:bind|catch)(?:tap|input|confirm|change|scroll)="([A-Za-z]+)"/g,
  ))
    assert.match(
      js,
      new RegExp("\\b" + match[1] + "\\s*\\("),
      `事件处理函数缺失 ${page}:${match[1]}`,
    );
  for (const expression of xml.matchAll(/\{\{([^}]+)\}\}/g))
    assert.doesNotMatch(
      expression[1],
      /\.\w+\s*\(/,
      "WXML表达式不能直接调用JavaScript方法",
    );
}
for (const tab of app.tabBar.list)
  for (const file of [tab.iconPath, tab.selectedIconPath]) {
    const png = readFileSync("miniprogram/" + file);
    assert.equal(png.subarray(1, 4).toString(), "PNG", "导航图标必须是PNG");
  }
for (const name of ["packet", "chest", "bag"]) {
  const png = readFileSync("miniprogram/assets/" + name + ".png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
}
console.log(
  `语法与JSON检查通过：${count}个文件；${app.pages.length}个小程序页面文件及事件引用检查通过。此检查不替代微信开发者工具编译。`,
);

for (const target of ["web/ad-pacing.js", "miniprogram/services/ad-pacing.js"])
  assert.equal(
    readFileSync(target, "utf8"),
    readFileSync("shared/ad-pacing.cjs", "utf8"),
    "广告预览调度源文件不一致；请从shared复制生成",
  );
