import { spawn } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function openBrowser(url, width = 1440, height = 1100) {
  const profile = mkdtempSync(join(tmpdir(), "wanfan-chrome-"));
  const browser = spawn(
    process.env.CHROMIUM_BIN || "chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let failure;
  browser.on("error", (e) => {
    failure = e;
  });
  const exited = new Promise((r) => browser.once("close", r));
  let socket;
  const pending = new Map();
  let serial = 0;
  const exceptions = [];
  async function close() {
    socket?.close();
    if (browser.exitCode === null) {
      browser.kill("SIGTERM");
      await Promise.race([exited, pause(3000)]);
    }
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 150 && !existsSync(portFile); i++) {
      if (failure) throw failure;
      await pause(100);
    }
    if (!existsSync(portFile))
      throw new Error("Chromium启动失败；设置CHROMIUM_BIN或安装Chromium");
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const target = await (
      await fetch(
        "http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent(url),
        { method: "PUT" },
      )
    ).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("message", (e) => {
      const d = JSON.parse(e.data);
      if (d.method === "Runtime.exceptionThrown")
        exceptions.push(d.params.exceptionDetails.text);
      const p = pending.get(d.id);
      if (p) {
        pending.delete(d.id);
        d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result);
      }
    });
    await new Promise((r, j) => {
      socket.addEventListener("open", r, { once: true });
      socket.addEventListener("error", j, { once: true });
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("浏览器命令超时：" + method));
        }, 12000);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const until = async (expression) => {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await pause(70);
      }
      throw new Error("页面状态未满足：" + expression);
    };
    const viewport = (width, height, mobile = false) =>
      send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
      });
    const screenshot = async (file, full = false) => {
      mkdirSync(dirname(file), { recursive: true });
      const r = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: full,
      });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    };
    const click = (selector) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await send("Page.enable");
    await send("Runtime.enable");
    await viewport(width, height);
    return {
      send,
      evaluate,
      until,
      viewport,
      screenshot,
      click,
      close,
      exceptions,
      socket,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
