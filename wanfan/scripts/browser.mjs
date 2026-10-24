import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DinnerStore } from "../server/store.mjs";
import { createDinnerApp } from "../server/index.mjs";
import { openBrowser } from "./browser-utils.mjs";
const store = new DinnerStore(),
  admin = randomBytes(32).toString("hex");
const { server } = createDinnerApp({ store, adminToken: admin });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let b;
try {
  const base = "http://127.0.0.1:" + server.address().port;
  b = await openBrowser(base);
  const idle = () =>
    b.until(
      "document.querySelector('#app').getAttribute('aria-busy')==='false'",
    );
  const shot = async (name, full = false) => {
    if (!process.argv.includes("--screenshots")) return;
    await b.evaluate("document.querySelector('#toast').hidden=true");
    await b.screenshot(resolve("wanfan/docs/screenshots", name + ".png"), full);
  };
  b.socket.addEventListener("message", (e) => {
    const v = JSON.parse(e.data);
    if (v.method === "Page.javascriptDialogOpening")
      b.send("Page.handleJavaScriptDialog", {
        accept: true,
        promptText: "已记录，我们会继续人工校对并补充菜谱。",
      }).catch(() => {});
  });
  await b.until("Boolean(document.querySelector('#preferences-form'))");
  await shot("desktop-today", true);
  await b.viewport(390, 844, true);
  await shot("mobile-today");
  assert.equal(
    await b.evaluate("document.documentElement.scrollWidth<=390"),
    true,
    "首页手机布局不能溢出",
  );
  await b.click("[data-nav=pantry]");
  await b.evaluate(
    "document.querySelector('#ingredient-id').value='tomato';document.querySelector('#ingredient-id').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#ingredient-amount').value='1';document.querySelector('#pantry-form').requestSubmit()",
  );
  await idle();
  await b.until(
    "document.querySelector('.ingredient-card')?.textContent.includes('番茄')",
  );
  const u = store.overview().users[0].id;
  assert.equal(store.pantry(u)[0].amount, 1);
  await shot("mobile-pantry");
  await b.click("[data-nav=today]");
  for (
    let i = 0;
    i < 12 &&
    !(await b.evaluate(
      "Boolean(document.querySelector('[data-recipe=tomato-egg]'))",
    ));
    i++
  ) {
    await b.click("[data-action=rotate]");
    await idle();
  }
  await b.click("[data-recipe=tomato-egg]");
  await b.until("document.querySelector('#recipe-dialog').open");
  await b.click("[data-favorite=tomato-egg]");
  await idle();
  assert.equal(store.journal(u).favorites.length, 1);
  await shot("mobile-recipe");
  await b.click("#recipe-content [data-plan=tomato-egg]");
  await idle();
  assert.equal(store.plans(u).length, 1);
  await b.click("[data-nav=shopping]");
  await b.until("Boolean(document.querySelector('[data-purchase=tomato]'))");
  assert.equal(store.shopping(u).find((i) => i.id === "tomato").missing, 1);
  await b.click("[data-purchase=tomato]");
  await idle();
  assert.equal(store.shopping(u).find((i) => i.id === "tomato").checked, true);
  await shot("mobile-shopping");
  await b.click("[data-complete]");
  await idle();
  assert.equal(store.journal(u).history.length, 1);
  assert.equal(store.pantry(u).length, 0);
  await b.click("[data-nav=journal]");
  await b.click("[data-action=checkin]");
  await idle();
  assert.equal(store.profile(u).streak, 1);
  await b.click("[data-action=feedback]");
  await b.evaluate(
    "document.querySelector('#text-value').value='希望有更多简单的蔬菜做法';document.querySelector('#text-form').requestSubmit()",
  );
  await idle();
  assert.equal(store.journal(u).feedback.length, 1);
  await b.click("[data-action=week]");
  await b.until(
    "document.querySelector('#recipe-content').textContent.includes('当前没有广告观看入口')",
  );
  assert.equal(
    await b.evaluate(
      "Boolean(document.querySelector('[data-action=generate-week]'))",
    ),
    false,
  );
  await b.click("[data-close=recipe-dialog]");
  await shot("mobile-journal");
  for (const width of [320, 390, 600]) {
    await b.viewport(width, 844, true);
    for (const page of ["today", "pantry", "shopping", "journal"]) {
      await b.click("[data-nav=" + page + "]");
      assert.equal(
        await b.evaluate("document.documentElement.scrollWidth<=" + width),
        true,
        page + "宽度" + width + "不能横向溢出",
      );
    }
  }
  await b.viewport(1440, 1100);
  await b.send("Page.navigate", { url: base + "/admin" });
  await b.until("Boolean(document.querySelector('#admin-token'))");
  await b.evaluate(
    `document.querySelector('#admin-token').value=${JSON.stringify(admin)};document.querySelector('#login-form').requestSubmit()`,
  );
  await b.until("!document.querySelector('#dashboard').hidden");
  await b.click("[data-grant]");
  await b.until(
    "document.querySelector('#dashboard').textContent.includes('内部体验有效')",
  );
  assert.equal(store.profile(u).entitlement.active, true);
  await b.click("[data-reply]");
  await b.until(
    "document.querySelector('#dashboard').textContent.includes('已回复')",
  );
  await b.click("[data-recipe=beef-pepper]");
  await b.until(
    "document.querySelector('[data-recipe=beef-pepper]').textContent==='重新启用'",
  );
  assert.equal(
    store.activeRecipes().some((r) => r.id === "beef-pepper"),
    false,
  );
  await shot("desktop-admin", true);
  await b.click("#logout");
  assert.equal(
    await b.evaluate(
      "document.querySelector('#dashboard').hidden && !document.querySelector('#admin-token').value",
    ),
    true,
  );
  await b.send("Page.navigate", { url: base });
  await b.until("Boolean(document.querySelector('#preferences-form'))");
  await b.click("[data-action=week]");
  await b.until(
    "Boolean(document.querySelector('[data-action=generate-week]'))",
  );
  await b.click("[data-action=generate-week]");
  await idle();
  assert.equal(
    await b.evaluate("document.querySelectorAll('.week-row').length"),
    7,
  );
  assert.equal(store.latestWeek(u).days.length, 7);
  await b.viewport(390, 844, true);
  await shot("mobile-week");
  await b.click("[data-close=recipe-dialog]");
  assert.deepEqual(b.exceptions, [], "不应出现未捕获的页面异常");
  console.log(
    "晚饭有谱浏览器实测通过：首次空状态、食材录入、菜谱收藏、选餐、采购换算与勾选、完成扣库存、签到、反馈回复、广告关闭、管理员权益、周计划、内容停用、退出及320/390/600px布局。",
  );
} finally {
  await b?.close();
  await new Promise((r) => server.close(r));
  store.close();
}
