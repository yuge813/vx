import { readdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser } from "./browser-utils.mjs";
import { createDinnerApp } from "../server/index.mjs";
import { DinnerStore } from "../server/store.mjs";
const store = new DinnerStore();
const { server } = createDinnerApp({ store });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  const base = "http://127.0.0.1:" + server.address().port;
  browser = await openBrowser("about:blank", 600, 420);
  await browser.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 238, g: 241, b: 229, a: 1 },
  });
  for (const name of readdirSync("wanfan/web/assets").filter((n) =>
    n.endsWith(".svg"),
  )) {
    await browser.send("Page.navigate", { url: base + "/assets/" + name });
    await browser.until(
      "document.readyState==='complete' && document.documentElement.nodeName==='svg'",
    );
    await browser.screenshot(
      join("wanfan/miniprogram/assets", name.replace(".svg", ".png")),
    );
  }
  console.log("9幅原创SVG已通过Chromium渲染为小程序PNG资源。");
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
}
