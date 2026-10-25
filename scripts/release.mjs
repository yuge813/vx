import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain"))
  throw new Error("工作区未提交，先验证并提交再生成对应源码包");
const sha = git("rev-parse", "HEAD"),
  version = JSON.parse(readFileSync("package.json", "utf8")).version,
  name = `yuanxiang-review-${version}-${sha.slice(0, 7)}.zip`;
mkdirSync("dist", { recursive: true });
execFileSync("git", [
  "archive",
  "--format=zip",
  "--prefix=yuanxiang-review/",
  "--output=dist/" + name,
  "HEAD",
]);
const manifest = {
  version,
  commit: sha,
  archive: name,
  sha256: createHash("sha256")
    .update(readFileSync("dist/" + name))
    .digest("hex"),
  notice:
    "仅包含已跟踪源码，不含本机密钥、数据库或未提交内容。真实广告、支付及微信真机接入见审核清单。",
};
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log("已生成 " + name + " 及SHA-256清单。");
