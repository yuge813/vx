import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "yx-container-")),
  suffix = randomBytes(8).toString("hex"),
  name = "yx-review-" + suffix,
  volume = "yx-review-data-" + suffix,
  secret = randomBytes(32).toString("hex");
const command = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", env: process.env }).trim();
let created = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const envFile = join(root, "container.env");
  writeFileSync(
    envFile,
    "APP_ENV=development\nAD_PROVIDER=demo\nADMIN_TOKEN=" + secret + "\n",
    { mode: 0o600 },
  );
  command(
    "run",
    "--detach",
    "--name",
    name,
    "--init",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--env-file",
    envFile,
    "-p",
    "127.0.0.1::8792",
    "-v",
    volume + ":/app/data",
    "yuanxiang-review:" +
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
  );
  created = true;
  let port = command(
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "8792/tcp") 0).HostPort}}',
      name,
    ),
    base = "http://127.0.0.1:" + port;
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {}
      await pause(100);
    }
    throw new Error("容器未就绪：" + command("logs", name));
  };
  await ready();
  const login = async () => {
    const r = await fetch(base + "/api/auth/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId: "container_fixture_" + suffix }),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  let auth = await login();
  const request = async (path, method = "GET", body, token = auth.token) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, 200, path);
    return r.json();
  };
  const task = await request("/api/tasks", "POST", { kind: "signin" });
  await pause(3100);
  await request("/api/tasks/" + task.id + "/complete", "POST", {});
  assert.equal((await request("/api/me")).balance, 620);
  assert.equal(
    (await request("/api/admin/reconciliation", "GET", null, secret)).ok,
    true,
  );
  command(
    "exec",
    name,
    "node",
    "scripts/backup.mjs",
    "/app/data/yuanxiang.sqlite",
    "/tmp/container-backup.sqlite",
  );
  command("stop", "--time", "10", name);
  command("start", name);
  port = command(
    "inspect",
    "--format",
    '{{(index (index .NetworkSettings.Ports "8792/tcp") 0).HostPort}}',
    name,
  );
  base = "http://127.0.0.1:" + port;
  await ready();
  auth = await login();
  assert.equal((await request("/api/me")).balance, 620);
  assert.equal(
    command(
      "exec",
      name,
      "node",
      "-e",
      "process.stdout.write(String(process.getuid()))",
    ),
    "1000",
  );
  console.log(
    "Docker实测通过：非root/只读文件系统启动，真实HTTP签到入账620，账务核对、在线备份、停止重启后数据保留。运行时" +
      command("exec", name, "node", "--version"),
  );
} finally {
  if (created) command("rm", "--force", name);
  try {
    command("volume", "rm", volume);
  } catch {}
  rmSync(root, { recursive: true, force: true });
}
