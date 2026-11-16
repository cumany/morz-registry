# morz-registry 自发布索引生成器

扫描 GitHub topic（`morz-plugin` / `morz-theme`），对每个仓库做确定性校验后自动生成
社区索引 `index.json`——作者**加 topic 即上架**，无需 PR、无需等待审核。

对应设计：`docs/PRODUCT-STRATEGY-2026.md` §5.2（DSH 自发布 + 自动索引 + 轻审核）。

## 作者发布步骤（全部自助，零排队）

1. 插件根目录放 `manifest.json`（id/name/version/sdk:1/permissions）+ `main.js`
2. 仓库加 topic：插件 `morz-plugin`，主题 `morz-theme`
3. 打 `v*` tag 发 Release（推荐；没有 Release 时索引会钉默认分支 commit）
4. 完事——下一次扫描（每天 03:00 UTC）自动进索引

## 校验规则（确定性，失败不进索引）

- manifest.json 合法 JSON：id 规范、name、semver version、`sdk: 1`
- `main.js` 存在、≤5MB、含 `activate` 入口
- 确定性危险模式：`eval(` / `new Function(` 命中即排除
- 通过的条目自动带 `sha256`（客户端安装时校验，审过的内容 = 发布的内容）

## 安装与更新

- 索引条目钉 `tag`（有 Release）或 `commit`（无 Release），永不跟随默认分支
- 客户端对比 `version` 提示更新；安装走 network.ts 镜像链（国内加速）

## 信任信号

- `trust: community`（本索引全部为社区条目；官方条目在 `cumany/Morz` 的 registry）
- stars / pushedAt 随扫描写入；官方 featured 列表人工策展（在官方索引里）

## 文件

- `scripts/scan.mjs` — 扫描 + 校验 + 生成
- `.github/workflows/scan.yml` — 每天 03:00 UTC + 手动触发，产物发布到本仓 `gh-pages`
- `gh-pages/index.json` — 索引产物（raw / jsDelivr / gh.morz.app 均可拉取）
- `gh-pages/scan-report.json` — 扫描报告（收录/排除理由，透明可查）
