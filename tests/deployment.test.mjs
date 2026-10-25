import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { runtimeConfig } from "../server/runtime-config.mjs";
const env = { ADMIN_TOKEN: "fixture_".repeat(6) };
test("开发与正式配置验证明确阻断不完整或错误配置，不输出密钥", () => {
  assert.equal(runtimeConfig(env).development, true);
  assert.throws(() => runtimeConfig({ ...env, PORT: "nan" }));
  assert.throws(() => runtimeConfig({ ...env, ADMIN_TOKEN: "short" }));
  assert.throws(() =>
    runtimeConfig({ ...env, APP_ENV: "production", AD_PROVIDER: "demo" }),
  );
  assert.throws(() =>
    runtimeConfig({ ...env, APP_ENV: "production", AD_PROVIDER: "disabled" }),
  );
  const prod = runtimeConfig({
    ...env,
    APP_ENV: "production",
    AD_PROVIDER: "disabled",
    PUBLIC_ORIGIN: "https://example.test",
    WX_APP_ID: "fixture-app-id",
    WX_APP_SECRET: "fixture-secret",
    OPERATOR_NAME: "测试企业",
    SUPPORT_CONTACT: "企业客服",
    PRIVACY_URL: "https://example.test/privacy",
  });
  assert.equal(prod.development, false);
  assert.equal(prod.provider, "disabled");
});
test("在线SQLite备份与新路径恢复保留账户、流水和角色，拒绝覆盖", () => {
  const dir = mkdtempSync(join(tmpdir(), "yx-backup-")),
    source = join(dir, "source.sqlite"),
    backup = join(dir, "backup.sqlite"),
    target = join(dir, "restored.sqlite");
  let store = new YuanxiangStore({ path: source });
  try {
    const user = store.login("backup_fixture").user;
    store.operations.rename(user.id, "备份用户");
    execFileSync(process.execPath, ["scripts/backup.mjs", source, backup], {
      cwd: resolve("."),
      stdio: "pipe",
    });
    execFileSync(process.execPath, ["scripts/restore.mjs", backup, target], {
      cwd: resolve("."),
      stdio: "pipe",
    });
    assert.throws(() =>
      execFileSync(process.execPath, ["scripts/restore.mjs", backup, target], {
        stdio: "pipe",
      }),
    );
    const restored = new YuanxiangStore({ path: target });
    try {
      assert.equal(restored.profile(user.id).name, "备份用户");
      assert.equal(restored.roomContent.admin().actors.length, 6);
      assert.equal(restored.operations.reconcile().ok, true);
    } finally {
      restored.close();
    }
    assert.throws(() =>
      execFileSync(process.execPath, ["scripts/backup.mjs", source, backup], {
        stdio: "pipe",
      }),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("小程序配置工具保留备份，正式URL只允许HTTPS且不接受密钥或凭据URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "yx-mini-config-"));
  const script = resolve("scripts/configure-mini.mjs");
  try {
    mkdirSync(join(dir, "miniprogram"));
    const config = readFileSync("miniprogram/config.js", "utf8");
    writeFileSync(join(dir, "miniprogram/config.js"), config);
    writeFileSync(
      join(dir, "miniprogram/project.config.json"),
      readFileSync("miniprogram/project.config.json"),
    );
    execFileSync(
      process.execPath,
      [
        script,
        "--api",
        "https://fixture.example",
        "--appid",
        "wx1234567890abcdef",
      ],
      { cwd: dir, stdio: "pipe" },
    );
    assert.match(
      readFileSync(join(dir, "miniprogram/config.js"), "utf8"),
      /https:\/\/fixture.example/,
    );
    assert.equal(
      readFileSync(join(dir, "miniprogram/config.js.user.bak"), "utf8"),
      config,
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [script, "--api", "http://fixture.example"],
        { cwd: dir, stdio: "pipe" },
      ),
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [script, "--api", "https://secret:secret@fixture.example"],
        { cwd: dir, stdio: "pipe" },
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
