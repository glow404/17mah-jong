# 贡献指南

感谢你愿意改进 17mah-jong。这个项目欢迎规则测试、用户体验、无障碍、文档和工程质量方面的贡献。

参与贡献即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。安全漏洞请按 [安全策略](SECURITY.md) 私下报告，不要创建公开 Issue。

## 开始之前

1. 搜索已有 Issue 和 Pull Request，避免重复工作。
2. 小型修复可以直接提交 Pull Request；新玩法、规则变更或架构调整应先创建 Issue 讨论。
3. 首次贡献可以从带有 [`good first issue`](https://github.com/glow404/17mah-jong/labels/good%20first%20issue) 的任务开始。
4. 不要在 Issue、提交或测试数据中包含真实邮箱、密码、Cookie、Token 或线上数据库内容。

## 开发环境

要求：

- Node.js 22.13.0 或更高版本；
- npm；
- Git；
- 只有调试联机与账号功能时才需要 Cloudflare 账号和个人 D1 数据库。

```bash
git clone https://github.com/glow404/17mah-jong.git
cd 17mah-jong
npm ci
npm run dev
```

应用默认运行在 `http://localhost:3000`。

如需使用本地 D1，请明确使用 `--local`，避免误操作远程数据库：

```bash
npx wrangler d1 migrations apply mahjong-db --local
```

不得提交 `.dev.vars`、`.env*`、本地数据库或个人 Cloudflare 配置。数据库结构发生变化时，修改 `db/schema.ts` 后运行 `npm run db:generate`，不要手工修改 Drizzle 的 `meta/` 文件。

## 分支规范

从最新的 `main` 创建短生命周期分支。推荐命名：

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `test/short-description`
- `chore/short-description`

不要直接向 `main` 推送功能开发提交。

## 提交信息

项目采用 Conventional Commits：

```text
feat(game): add discard timer
fix(scoring): handle four-han mangan boundary
test(rules): cover temporary furiten reset
docs: clarify local D1 setup
chore(deps): update development dependencies
```

常用类型为 `feat`、`fix`、`test`、`docs`、`refactor`、`perf`、`chore` 和 `ci`。每个提交只处理一个清晰目标，并保证提交信息能够解释改动的结果。

## 修改要求

- 规则引擎应保持确定性和可测试性，不要把 React、网络或数据库逻辑放入 `lib/mahjong.ts`。
- 规则、番符和计分变化必须同时添加回归测试，并说明与项目规则的关系。
- API 变化必须验证鉴权、隐藏信息和非法状态处理。
- UI 变化应检查桌面端、移动端、键盘操作、ARIA 标签和声音关闭状态。
- 不要提交 `.next/`、`.vinext/`、`dist/`、`work/`、`.wrangler/` 等生成目录。
- 用户可见行为发生变化时，请同步更新 README 或 `CHANGELOG.md` 的 `Unreleased` 部分。

## 本地验证

提交 Pull Request 前至少运行：

```bash
npm run lint
npx tsc --noEmit
npm test
```

`npm test` 会运行规则测试并执行生产构建。所有命令都应成功，且不应产生新的警告。

## Pull Request 流程

1. 将分支变基或同步到最新 `main`。
2. 使用 PR 模板说明目的、实现、测试和风险。
3. 用 `Closes #123` 关联 Issue。
4. 保持改动规模适合审查；无关重构应拆成单独 PR。
5. 根据评审意见更新代码，并确保自动化检查持续通过。
6. PR 合并后由维护者负责版本和发布记录。

提交代码即表示你同意按照本项目的 [MIT License](LICENSE) 授权你的贡献。
