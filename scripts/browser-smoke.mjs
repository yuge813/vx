import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'xingxiang-chromium-'));
const admin = randomBytes(32).toString('hex');
const store = new Store();
const { server } = createApp({ store, adminToken: admin });
let browser, socket, browserExit;
const pending = new Map(), errors = []; let serial = 0;
async function send(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('浏览器命令超时：' + method)); }, 12000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('浏览器脚本执行失败：' + result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(70); }
  throw new Error('页面状态未达到预期：' + expression);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function screenshot(name) {
  if (!process.argv.includes('--screenshots')) return;
  const directory = resolve('docs/screenshots'); mkdirSync(directory, { recursive: true });
  await evaluate("document.querySelector('#toast').hidden=true");
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !name.startsWith('mobile') });
  writeFileSync(join(directory, name + '.png'), Buffer.from(image.data, 'base64'));
}
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  browserExit = new Promise(r => browser.once('close', r));
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) { if (launchError) throw launchError; await pause(100); }
  assert.ok(existsSync(portFile), 'Chromium启动失败。安装Chromium或设置CHROMIUM_BIN后重试。');
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(base), { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
    const request = pending.get(data.id);
    if (request) { pending.delete(data.id); data.error ? request.reject(new Error(data.error.message)) : request.resolve(data.result); }
  });
  await new Promise((r,j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await until("Boolean(document.querySelector('[data-action=checkin]'))");
  await screenshot('desktop-home');
  await click('[data-action=checkin]');
  await until("document.querySelector('[data-action=checkin]')?.textContent.includes('已签到')");
  await evaluate("document.querySelector('#plan-title').value='浏览器验证：整理书架';document.querySelector('#plan-form').requestSubmit()");
  await until("document.querySelector('#app').textContent.includes('浏览器验证：整理书架')");
  await evaluate("Array.from(document.querySelectorAll('.plan')).find(p=>p.textContent.includes('浏览器验证：整理书架')).querySelector('input').click()");
  await until("Array.from(document.querySelectorAll('.plan.done')).some(p=>p.textContent.includes('浏览器验证：整理书架'))");
  await click('[data-page=chests]'); await click('[data-action=ready]');
  await until("document.querySelector('#chest-open') && !document.querySelector('#chest-open').disabled");
  await screenshot('desktop-chests');
  await click('#chest-open'); await until("document.querySelector('#reward-dialog').open");
  await click('#reward-confirm');
  await until("!document.querySelector('#reward-dialog').open && document.querySelector('#toast').textContent.includes('金币已入账')");
  await click('[data-page=wallet]');
  await evaluate("document.querySelector('#withdraw-form').requestSubmit()");
  await until("document.querySelector('#app').textContent.includes('待审核（演示）')");
  const user = store.adminOverview().users[0];
  assert.equal(user.balance, 2810); assert.equal(user.frozen, 1000);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('mobile-wallet');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 390'), true, '手机页面不能横向溢出');
  await click('[data-page=home]'); await screenshot('mobile-home');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/admin' });
  await until("Boolean(document.querySelector('#admin-token'))");
  await evaluate(`document.querySelector('#admin-token').value=${JSON.stringify(admin)};document.querySelector('#login-form').requestSubmit()`);
  await until("!document.querySelector('#dashboard').hidden && Boolean(document.querySelector('[data-review=approve]'))");
  await click('[data-review=approve]');
  await until("Boolean(document.querySelector('[data-review=simulate_pay]'))");
  const dialogHandler = event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  };
  socket.addEventListener('message', dialogHandler);
  await click('[data-review=simulate_pay]');
  await until("document.querySelector('#dashboard').textContent.includes('模拟完成 · 未付款')");
  socket.removeEventListener('message', dialogHandler);
  assert.equal(store.user(user.id).frozen, 0); assert.equal(store.user(user.id).paid, 1000);
  await evaluate("document.querySelector('[name=subsidyCoins]').value='35';document.querySelector('#settings-form').requestSubmit()");
  await until("document.querySelector('#dashboard').textContent.includes('规则版本 v2')");
  assert.equal(store.settings().subsidyCoins, 35);
  await screenshot('desktop-admin');
  await click('#logout');
  assert.equal(await evaluate("document.querySelector('#dashboard').hidden && !document.querySelector('#admin-token').value"), true);
  assert.deepEqual(errors, [], '不应有浏览器未捕获异常');
  console.log('浏览器实际交互验证通过：签到、计划保存、宝箱计时、演示观看、金币入账、提现冻结、后台审核、模拟完成、补贴配置、管理员退出及390px布局。');
} finally {
  socket?.close();
  for (const request of pending.values()) request.reject(new Error('浏览器关闭'));
  if (browser && browser.exitCode === null) { browser.kill('SIGTERM'); await Promise.race([browserExit, pause(3000)]); }
  await new Promise(r => server.close(r)); store.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
