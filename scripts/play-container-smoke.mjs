// 实际Docker运行与娱乐数据持久化检查；只操作本脚本创建的临时容器/卷。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "yx-play-container-"));
const suffix = randomBytes(8).toString("hex");
const name = "yx-play-" + suffix;
const volume = "yx-play-data-" + suffix;
const secret = randomBytes(32).toString("hex");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const image = process.env.PLAY_IMAGE || "yuanxiang-review:" + version;
const command = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", env: process.env }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let created = false;
let base;
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
    image,
  );
  created = true;
  const locate = () => {
    const port = command(
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "8792/tcp") 0).HostPort}}',
      name,
    );
    base = "http://127.0.0.1:" + port;
  };
  const ready = async () => {
    locate();
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {}
      await pause(100);
    }
    throw new Error("趣玩容器未就绪：" + command("logs", name));
  };
  await ready();
  const configResponse = await fetch(base + "/api/config");
  assert.equal(configResponse.status, 200);
  assert.equal(
    (await configResponse.json()).appVersion,
    version,
    "不能把旧镜像当作本轮整合版",
  );
  assert.equal(
    command("inspect", "--format", "{{.HostConfig.ReadonlyRootfs}}", name),
    "true",
  );
  const copiedPrivateFiles = JSON.parse(
    command(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import {readdirSync} from 'node:fs';import {join} from 'node:path';const found=[];const walk=p=>{for(const e of readdirSync(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())walk(f);else if(e.name.startsWith('.env')||e.name.endsWith('.user.bak')||e.name==='project.private.config.json'||/\\.sqlite(?:-|$)/.test(e.name))found.push(f);}};for(const part of ['server','web','shared','miniprogram','scripts'])walk('/app/'+part);process.stdout.write(JSON.stringify(found));",
    ),
  );
  assert.deepEqual(
    copiedPrivateFiles,
    [],
    "镜像源码目录不能包含本机环境文件、备份或数据库",
  );
  const runtimeFiles = [
    "server/index.mjs",
    "server/yuanxiang.mjs",
    "server/operations.mjs",
    "server/play.mjs",
    "server/play-routes.mjs",
    "server/play-questions.mjs",
    "shared/play-games.cjs",
    "web/app.js",
    "web/style.css",
    "web/play.js",
    "web/play.css",
    "web/play-admin.js",
    "web/play-admin.css",
    "web/play-games.js",
    "miniprogram/app.json",
    "miniprogram/pages/play/index.js",
    "miniprogram/pages/play/index.wxml",
    "miniprogram/pages/play/index.wxss",
    "miniprogram/services/play-games.js",
  ];
  const sourceHashes = Object.fromEntries(
    runtimeFiles.map((file) => [
      file,
      createHash("sha256").update(readFileSync(file)).digest("hex"),
    ]),
  );
  const imageHashes = JSON.parse(
    command(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';const files=" +
        JSON.stringify(runtimeFiles) +
        ";process.stdout.write(JSON.stringify(Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync('/app/'+f)).digest('hex')]))));",
    ),
  );
  assert.deepEqual(
    imageHashes,
    sourceHashes,
    "镜像运行代码必须与本次待交付源码一致",
  );
  const installationId = "play_container_" + suffix;
  const login = async () => {
    const response = await fetch(base + "/api/auth/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  let auth = await login();
  const request = async (path, method = "GET", body, token = auth.token) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(
      response.status,
      200,
      path + ": " + (data.error?.message || ""),
    );
    return data;
  };
  assert.equal((await request("/api/play/overview")).enabled, true);
  const quiz = await request("/api/play/quiz");
  const answer = await request(
    "/api/play/quiz/" + quiz.id + "/answer",
    "POST",
    {
      questionId: quiz.current.id,
      choice: 0,
    },
  );
  assert.equal(answer.session.answered, 1);
  let merge = await request("/api/play/games", "POST", {
    kind: "merge",
    requestKey: "merge_" + suffix,
  });
  merge = await request("/api/play/games/" + merge.id + "/action", "POST", {
    actionId: "move_" + suffix,
    revision: merge.revision,
    direction: "left",
  });
  let memory = await request("/api/play/games", "POST", {
    kind: "memory",
    requestKey: "memory_" + suffix,
  });
  assert.ok(
    memory.state.cards.every((card) => card === null),
    "暗牌不泄露给HTTP调用者",
  );
  memory = await request("/api/play/games/" + memory.id + "/action", "POST", {
    actionId: "flip_" + suffix,
    revision: memory.revision,
    index: 0,
  });
  assert.equal(memory.state.open.length, 1);
  await request("/api/play/games/" + memory.id + "/presence", "POST", {
    active: false,
  });
  assert.equal((await request("/api/me")).balance, 0, "趣玩不发开发金币或现金");
  assert.equal(
    (await request("/api/admin/reconciliation", "GET", undefined, secret)).ok,
    true,
  );
  command(
    "exec",
    name,
    "node",
    "scripts/backup.mjs",
    "/app/data/yuanxiang.sqlite",
    "/app/data/play-backup.sqlite",
  );
  command(
    "exec",
    name,
    "node",
    "scripts/restore.mjs",
    "/app/data/play-backup.sqlite",
    "/app/data/play-restored.sqlite",
  );
  const restored = JSON.parse(
    command(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/app/data/play-restored.sqlite',{readOnly:true});const row=d.prepare('SELECT state_json FROM play_games WHERE id=?').get(" +
        JSON.stringify(merge.id) +
        ");process.stdout.write(JSON.stringify({count:d.prepare('SELECT COUNT(*) AS n FROM play_games').get().n,state:JSON.parse(row.state_json)}));d.close();",
    ),
  );
  assert.equal(restored.count, 2);
  assert.deepEqual(
    restored.state.board,
    merge.state.board,
    "备份恢复包含已保存棋盘",
  );
  command("stop", "--time", "10", name);
  command("start", name);
  await ready();
  auth = await login();
  const quizAfter = await request("/api/play/quiz");
  const mergeAfter = await request("/api/play/games/" + merge.id);
  const memoryAfter = await request("/api/play/games/" + memory.id);
  assert.equal(quizAfter.id, quiz.id);
  assert.equal(quizAfter.answered, 1);
  assert.deepEqual(mergeAfter.state, merge.state);
  assert.equal(mergeAfter.revision, merge.revision);
  assert.equal(memoryAfter.paused, true);
  assert.deepEqual(memoryAfter.state, memory.state);
  assert.equal((await request("/api/me")).balance, 0);
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
    "趣玩Docker实测通过：非root/只读系统启动，真实HTTP答题和棋盘动作、暗牌隐藏、在线备份恢复、停止重启后趣答/合成/翻牌数据保留，趣玩未发金币。镜像" +
      image,
  );
} finally {
  if (created) command("rm", "--force", name);
  try {
    command("volume", "rm", volume);
  } catch {}
  rmSync(root, { recursive: true, force: true });
}
