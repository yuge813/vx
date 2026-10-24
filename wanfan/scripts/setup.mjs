import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env.wanfan"))
  console.log("保留已有.env.wanfan，未改动旧版本.env或数据。");
else {
  writeFileSync(
    ".env.wanfan",
    `APP_ENV=development\nHOST=127.0.0.1\nPORT=8790\nDB_PATH=./data/wanfan.sqlite\nADMIN_TOKEN=${randomBytes(32).toString("hex")}\nPUBLIC_ORIGIN=\nWX_APP_ID=\nWX_APP_SECRET=\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "已生成独立.env.wanfan；后台使用其中ADMIN_TOKEN，真实广告与支付无开启开关。",
  );
}
