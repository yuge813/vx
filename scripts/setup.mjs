import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('保留已有 .env。可直接 npm start。');
} else {
  writeFileSync('.env', `APP_ENV=development\nHOST=127.0.0.1\nPORT=8787\nDB_PATH=./data/xingxiang.sqlite\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\nAD_PROVIDER=demo\nWX_APP_ID=\nWX_APP_SECRET=\n`, { mode: 0o600, flag: 'wx' });
  console.log('已生成本机 .env。后台登录使用其中的 ADMIN_TOKEN；不要分享或提交该文件。');
}
