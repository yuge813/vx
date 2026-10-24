# 晚饭有谱 · 新版微信产品内部原型

**从“今天吃什么”到“这顿做完了”**：按人数与用时选餐、查看完整做法、管理食材、计算缺料、记录采购进度和真实日常。签到免费，基础流程不依赖广告。

工作名称及品牌权利尚待核验。当前不是已获微信商业准入的上线成品，不能保证留存、收益或永不封禁。

## 先看产品与证据

- [第一阶段：规则核实、3个方向、推荐、用户路径、视觉与经营模型](wanfan/docs/产品与规则评估.md)
- [官方资料访问记录](wanfan/docs/research-access.json)
- [安装、微信导入、服务器测试与部署说明](wanfan/docs/部署说明.md)
- [验证结果与上线门槛](wanfan/docs/验收与上线门槛.md)

2026-10-25，当前环境访问微信规则、广告和支付官网返回代理403。官方公开代码能核实部分接口，但奖励用途、企业类目和流量主准入尚未核实。新产品真实广告、现金、实物兑换及支付始终关闭；配置和客户端参数都不能开启。

## 运行新版

需要Node.js 24或更新版本，无第三方运行依赖，无需npm install。在项目根目录执行：

```bash
npm run setup
npm start
```

默认本机8790端口，用户端 `/`，后台 `/admin`。setup生成独立的 `.env.wanfan`，后台使用其中的ADMIN_TOKEN，不要公开该值。数据库独立保存至 `data/wanfan.sqlite`。手工配置模板在 `wanfan/.env.example`，复制目标是根目录 `.env.wanfan`。

微信开发者工具导入 **`wanfan/miniprogram`**。本机接口默认8790；真实AppID、HTTPS域名和开发者工具/真机验证仍需完成。

旧版位于分支 `codex/xingxiang-mvp`，原本机 `.env` 和 `data/xingxiang.sqlite` 不变，金币不迁入新版。新分支也保留旧代码，可运行 `npm run legacy:start`（默认旧端口8787）。旧版原说明在 [这里](docs/legacy/xingxiang-README.md)。

## 功能与实际状态

| 能力                     | 状态                                                        |
| ------------------------ | ----------------------------------------------------------- |
| 人数、用时、蛋奶素食偏好 | 服务端筛选并保存                                            |
| 菜谱                     | 12道本项目原创开发稿，待人工烹饪校对                        |
| 插画                     | 9幅本项目原创SVG；原生端附PNG，无外部图片或字体依赖         |
| 冰箱与日期               | 手动数量及自设日期；过日期不计入可用库存，不判断食品安全    |
| 今晚菜单与采购           | 幂等选餐、份量换算、缺料合并；采购勾选不自动增加库存        |
| 做饭记录                 | 完成只扣一次已记录的有效库存，不足部分按0处理               |
| 签到与收藏               | 北京时间真实日历与连续天数，免费，无金币                    |
| 反馈、删除               | 实际反馈入库及后台回复；账户删除级联移除个人记录和会话      |
| 周计划助手               | 真正生成7天候选与合计用料，仅管理员可授予24小时内部测试权益 |
| 内容后台                 | 菜谱停用、必要事件统计、真实队列回访、反馈与审计            |
| 微信登录                 | 服务端交换代码和受控上游测试；未验证真实微信网络调用        |
| 微信广告与支付           | 未接入、关闭，无模拟广告成功，无现金账户                    |

内部权益每用户每日最多授予一次、全局每日最多100位，生成周计划每日最多10次。这些是开发参数，不是微信规则。权益过期后保留已有成果；正式模式不允许测试授予。

周计划为未来可能的可选广告权益，具体用途需平台确认。基础选餐、完整做法、食材、采购和签到始终可以不看广告使用。没有虚假聊天、在线人数、现金红包或兑付承诺。

## 页面截图

以下均为真实浏览器运行截图，**不是微信开发者工具或真机截图**。

- [手机首页](wanfan/docs/screenshots/mobile-today.png)
- [手机菜谱](wanfan/docs/screenshots/mobile-recipe.png)
- [手机冰箱](wanfan/docs/screenshots/mobile-pantry.png)
- [手机采购](wanfan/docs/screenshots/mobile-shopping.png)
- [手机日常](wanfan/docs/screenshots/mobile-journal.png)
- [内部周计划](wanfan/docs/screenshots/mobile-week.png)
- [桌面首页](wanfan/docs/screenshots/desktop-today.png)
- [内容运营后台](wanfan/docs/screenshots/desktop-admin.png)

## 测试

```bash
npm test
npm run check
# 可选：需要Chromium；仅访问本机测试服务
npm run test:browser -- --screenshots
```

npm test包含旧版回归与新版后端、实际HTTP、原生wx适配层契约。npm run check检查两套脚本、JSON及WXML，不能替代微信编译。浏览器回归覆盖320/390/600px及桌面；截图用内部临时数据库，不填造用户或收入数据。

`wanfan/scripts/render-assets.mjs` 可在装有Chromium时重新渲染原创SVG为PNG；交付已包含PNG，不需要用户安装图形工具。自动测试中的无沙盒浏览器只用于隔离环境的本机页面，不用来浏览未知网站。

## 目录

```text
wanfan/
  server/       新版HTTP、SQLite事务、原创菜谱
  web/          新版浏览器端、内容后台、SVG素材
  miniprogram/  5个原生页面、HTTP客户端、PNG素材
  tests/        后端、HTTP、原生客户端契约
  scripts/      初始化、静态检查、浏览器回归与素材渲染
  docs/         产品证据、部署、验收与截图
  deploy/       尚未在用户服务器执行的systemd/Nginx模板
```

这是基于工程可行性的产品假设。真实做饭用户的获客、次日/7日复用与广告意愿尚未验证，不能沿用现金奖励用户的留存假设。
