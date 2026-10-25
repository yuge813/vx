import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { openBrowser, pause } from "./browser-utils.mjs";
const store = new YuanxiangStore(),
  admin = randomBytes(32).toString("hex"),
  { server } = createYuanxiangApp({ store, adminToken: admin }),
  download = mkdtempSync(join(tmpdir(), "yx-export-"));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let b;
try {
  const base = "http://127.0.0.1:" + server.address().port;
  b = await openBrowser(base);
  b.socket.addEventListener("message", (e) => {
    const d = JSON.parse(e.data);
    if (d.method === "Page.javascriptDialogOpening")
      b.send("Page.handleJavaScriptDialog", {
        accept: true,
        promptText: "资料与账务已核对，测试审核",
      }).catch(() => {});
  });
  await b.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: download,
  });
  const idle = () =>
    b.until(
      "document.querySelector('#app').getAttribute('aria-busy')==='false'",
    );
  const shot = async (name) => {
    if (process.argv.includes("--screenshots"))
      await b.screenshot(resolve("docs/screenshots/yuanxiang", name + ".png"));
  };
  await b.until(
    "Boolean(document.querySelector('[data-nav=privacy]')) || Boolean(document.querySelector('#navigation [data-nav=profile]'))",
  );
  const u = store.adminOverview().users[0].id;
  await b.click("#navigation [data-nav=profile]");
  await b.click("[data-nav=privacy]");
  await b.evaluate(
    "document.querySelector('#profile-name-form [name=name]').value='夜间审核账户';document.querySelector('#profile-name-form').requestSubmit()",
  );
  await idle();
  assert.equal(store.profile(u).name, "夜间审核账户");
  await b.click("[data-action=export-account]");
  for (
    let i = 0;
    i < 100 && !readdirSync(download).some((x) => x.endsWith(".json"));
    i++
  )
    await pause(50);
  const exported = JSON.parse(
    readFileSync(
      join(
        download,
        readdirSync(download).find((x) => x.endsWith(".json")),
      ),
      "utf8",
    ),
  );
  assert.equal(exported.profile.id, u);
  assert.equal("identity" in exported.profile, false);
  await b.evaluate(
    "document.querySelector('#account-closure-form [name=reason]').value='停止使用开发测试账户';document.querySelector('#account-closure-form [type=checkbox]').checked=true;document.querySelector('#account-closure-form').requestSubmit()",
  );
  await idle();
  assert.equal(store.profile(u).closureRequest.state, "pending");
  for (const width of [320, 390, 600]) {
    await b.viewport(width, 844, true);
    assert.equal(
      await b.evaluate("document.documentElement.scrollWidth<=" + width),
      true,
      "隐私页宽度" + width,
    );
  }
  await b.viewport(390, 844, true);
  await shot("mobile-privacy");
  await b.click("[data-action=logout]");
  await b.until(
    "document.querySelector('#app').textContent.includes('会话已退出')",
  );
  await b.click("[data-action=retry]");
  await b.until("Boolean(document.querySelector('[data-claim=signin]'))");
  assert.equal(store.adminOverview().users.length, 1);
  await b.viewport(1440, 1100);
  await b.send("Page.navigate", { url: base + "/admin" });
  await b.until("document.body.dataset.adminReady==='true'");
  await b.evaluate(
    `document.querySelector('#admin-token').value=${JSON.stringify(admin)};document.querySelector('#login-form').requestSubmit()`,
  );
  await b.until("Boolean(document.querySelector('#operations'))");
  await b.click("[data-closure-review=reject]");
  await b.until(
    "Boolean(document.querySelector('[data-closure-state=rejected]'))",
  );
  assert.equal(store.profile(u).closureRequest.state, "rejected");
  for (const entry of [
    {
      kind: "ad_settled",
      amountFen: 10000,
      reference: "review-income-001",
      memo: "最终结算测试账单",
    },
    {
      kind: "infrastructure",
      amountFen: 2000,
      reference: "review-cost-001",
      memo: "主机费用测试账单",
    },
  ]) {
    await b.evaluate(
      `{const f=document.querySelector('#business-entry-form');for(const [k,v]of Object.entries(${JSON.stringify(entry)}))f.elements.namedItem(k).value=v;f.requestSubmit();}`,
    );
    await b.until(
      `document.querySelector('#operations').textContent.includes(${JSON.stringify(entry.reference)})`,
    );
  }
  assert.equal(store.operations.report(1).rows[0].recordedNetFen, 8000);
  await b.evaluate(
    "document.querySelector('#user-search-form [name=query]').value='夜间审核';document.querySelector('#user-search-form').requestSubmit()",
  );
  await b.until("Boolean(document.querySelector('[data-user-detail]'))");
  await b.click("[data-user-detail]");
  await b.until(
    "document.querySelector('#user-detail-result').textContent.includes('夜间审核账户')",
  );
  await b.evaluate(
    "document.querySelector('#operations').scrollIntoView({block:'start'})",
  );
  await shot("desktop-operations");
  await b.click(
    '[data-entry-void=\"' +
      store.operations.report(1).entries.find((e) => e.kind === "ad_settled")
        .id +
      '\"]',
  );
  await b.until(
    "document.querySelector('#operations').textContent.includes('已冲销')",
  );
  assert.equal(store.operations.report(1).rows[0].revenueFen, 0);
  assert.equal(store.operations.reconcile().ok, true);
  const request = store.operations.requestClosure(u, {
    reason: "重新申请注销审核测试",
    discardUnclaimed: true,
  });
  await b.click("[data-refresh]");
  await b.until(
    `Boolean(document.querySelector('[data-closure-review=approve][data-request-key="${request.id}"]'))`,
  );
  await b.click(
    `[data-closure-review=approve][data-request-key="${request.id}"]`,
  );
  await b.until(
    "Boolean(document.querySelector('[data-closure-state=approved]'))",
  );
  assert.equal(store.user(u).status, "closed");
  assert.equal(
    await b.evaluate("sessionStorage.getItem('yx.admin.detail')"),
    null,
  );
  assert.equal(
    await b.evaluate(
      "document.querySelector('#user-detail-result').textContent",
    ),
    "",
  );
  assert.equal(store.operations.reconcile().ok, true);
  assert.deepEqual(b.exceptions, []);
  console.log(
    "运营与隐私浏览器验收通过：改昵称、真实JSON下载、退出重登、注销申请/拒绝/审核、人工收支及冲销、用户查询与账务核对。",
  );
} catch (e) {
  console.error(
    "浏览器诊断",
    b
      ? await b.evaluate(
          "({login:document.querySelector('#login-error')?.textContent,toast:document.querySelector('#toast')?.textContent,operations:!!document.querySelector('#operations')})",
        )
      : null,
    b?.exceptions,
  );
  throw e;
} finally {
  await b?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(download, { recursive: true, force: true });
}
