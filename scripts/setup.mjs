import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".env.yuanxiang")) {
  console.log(
    "保留已有 .env.yuanxiang，不修改其他版本配置。可直接 npm start。",
  );
} else {
  writeFileSync(
    ".env.yuanxiang",
    `APP_ENV=development\nHOST=127.0.0.1\nPORT=8792\nDB_PATH=./data/yuanxiang.sqlite\nADMIN_TOKEN=${randomBytes(32).toString("hex")}\nAD_PROVIDER=demo\nPUBLIC_ORIGIN=\nWX_APP_ID=\nWX_APP_SECRET=\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "已生成独立 .env.yuanxiang，后台使用其中ADMIN_TOKEN。旧配置和数据保留。",
  );
}
