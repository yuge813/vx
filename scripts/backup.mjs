import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
const args = process.argv.slice(2),
  source = resolve(args[0] || process.env.DB_PATH || "data/yuanxiang.sqlite"),
  target = resolve(
    args[1] ||
      "backups/yuanxiang-" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        ".sqlite",
  );
if (!existsSync(source)) throw new Error("源数据库不存在；先启动项目创建数据");
if (existsSync(target) || source === target)
  throw new Error("备份目标已存在或与源相同，不覆盖");
mkdirSync(dirname(target), { recursive: true });
let db,
  verify,
  created = false;
try {
  db = new DatabaseSync(source, { readOnly: true });
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='yuanxiang_meta'")
      .get()
  )
    throw new Error("源文件不是本产品数据库");
  closeSync(openSync(target, "wx", 0o600));
  created = true;
  await backup(db, target);
  verify = new DatabaseSync(target, { readOnly: true });
  if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
    throw new Error("备份完整性检查失败");
  verify.close();
  verify = null;
  chmodSync(target, 0o600);
  console.log("在线备份已完成并通过SQLite完整性检查：" + target);
} catch (e) {
  if (created && existsSync(target)) {
    verify?.close();
    verify = null;
    unlinkSync(target);
  }
  throw e;
} finally {
  verify?.close();
  db?.close();
}
