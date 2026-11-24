# morz-registry 自发布索引生成器

扫描 GitHub topic（`morz-plugin` / `morz-theme`），对每个仓库做确定性校验 + AI 审核后
自动生成社区索引 `index.json`——作者**加 topic 即进入扫描**，无需 PR。


## 作者发布步骤（全部自助，零排队）

1. 插件根目录放 `manifest.json`（id/name/version/sdk:1/permissions）+ `main.js`
2. 仓库加 topic：插件 `morz-plugin`，主题 `morz-theme`
3. 打 `v*` tag 发 Release（推荐；没有 Release 时索引会钉默认分支 commit）
4. 完事——下一次扫描（每天 03:00 UTC）自动进索引

## 校验规则（确定性，失败不进索引）

- manifest.json 合法 JSON：id 规范、name、semver version、`sdk: 1`
- `main.js` 存在、≤5MB、含 `activate` 入口
- 确定性危险模式：`eval(` / `new Function(` 命中即排除
- 声明 `vault:read` 却调用 `ctx.vault` 写操作 → 排除
- 通过的条目自动带 `sha256`（客户端安装时校验，审过的内容 = 发布的内容）

## AI 审核（可选门禁）

`scripts/review.mjs` 把 manifest + 入口代码（长文件截断）交给 OpenAI 兼容模型，
按固定 rubric 输出 `pass / warn / reject`。`reject` 或审核失败（配置了 key 但 API 出错）
**不进入索引**；同一 repo + commit + sha256 复用上次结论，避免每天重复付费。

GitHub Actions 需要：

| 名称 | 类型 | 说明 |
|---|---|---|
| `LLM_API_KEY` | Secret | 必填；不配置时 `review.status=skipped`，只跑确定性校验 |
| `LLM_BASE_URL` | Variable（可选） | 默认 `https://api.openai.com/v1` |
| `LLM_MODEL` | Variable（可选） | 默认 `gpt-4o-mini` |

AI 审核是辅助门禁，不是安全沙箱：代码是公开的、模型只做静态判断，不能证明插件无害；
确定性校验、sha256、客户端权限提示和举报/下架仍然保留。扫描报告里会写
`review.status / risk / reasons`，便于复查。

## 安装与更新

- 索引条目钉 `tag`（有 Release）或 `commit`（无 Release），永不跟随默认分支
- 客户端对比 `version` 提示更新；安装走 network.ts 镜像链（国内加速）

## 信任信号

- `trust: community`（本索引全部为社区条目；官方条目在 `cumany/Morz` 的 registry）
- stars / pushedAt 随扫描写入；官方 featured 列表人工策展（在官方索引里）

## 文件

- `scripts/scan.mjs` — 扫描 + 确定性校验 + 生成
- `scripts/review.mjs` — AI 审核（OpenAI 兼容）
- `.github/workflows/scan.yml` — 每天 03:00 UTC + 手动触发，产物发布到本仓 `gh-pages`
- `gh-pages/index.json` — 索引产物（raw / jsDelivr / gh.morz.app 均可拉取）
- `gh-pages/scan-report.json` — 扫描报告（收录/排除理由，透明可查）
