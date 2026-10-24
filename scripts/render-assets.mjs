import { readdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser } from "./browser-utils.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
const store = new YuanxiangStore();
const { server } = createYuanxiangApp({ store });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  const base = "http://127.0.0.1:" + server.address().port;
  browser = await openBrowser("about:blank");
  await browser.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  for (const name of readdirSync("web/assets").filter((n) =>
    n.endsWith(".svg"),
  )) {
    await browser.viewport(
      name.startsWith("nav-") ? 81 : name.startsWith("avatar-") ? 96 : 600,
      name.startsWith("nav-") ? 81 : name.startsWith("avatar-") ? 96 : 420,
    );
    await browser.send("Page.navigate", { url: base + "/assets/" + name });
    await browser.until(
      "document.readyState==='complete' && document.documentElement.nodeName==='svg'",
    );
    await browser.screenshot(
      join("miniprogram/assets", name.replace(".svg", ".png")),
    );
  }
  console.log("3幅原创玩法插画、10幅导航图标及6幅活动助手头像已渲染为PNG。");
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
}
