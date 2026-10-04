# 二人麻将（17mah-jong）

一款“34 张选牌、两立直开局、满贯起胡”的两人麻将网页游戏，支持电脑对战和六位房间码联机对战。

## 核心规则

- 从标准 136 张麻将牌中，为双方各发 34 张；每人自选 13 张听牌。
- 未选的 21 张完整保留；每一巡都可以从中任意选择一张舍出。双方第一次舍牌即为两立直（2 番）。
- 只能荣和对方舍牌，不能自摸；低于满贯的和牌不可宣告荣和。
- 支持宝牌指示牌、永久振听和放弃荣和后的临时振听。
- 双方各舍出 17 张仍无人和牌则流局。
- 庄家固定自风东，闲家固定自风西。
- 满贯、跳满、倍满、三倍满、役满分别按底分的 1、1.5、2、3、4 倍结算。
- 荣和结算会公开赢家的 13 张手牌与荣和牌，并翻开里宝牌指示牌计入番数。
- 电脑对战免登录；联机房间使用邮箱和密码注册/登录，账号密码通过 PBKDF2 加盐哈希保存。
- 对局中提供可关闭的背景音乐，以及舍牌和荣和音效。

已实现的常见日麻役种包括平和、断幺九、一杯口、役牌、三色同顺/同刻、一气通贯、对对和、三暗刻、混全/纯全、混一色、清一色、七对子、小三元，以及国士无双、大三元、四暗刻、字一色、绿一色、清老头、大小四喜、九莲宝灯等役满。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。联机房间使用 Cloudflare D1；本地开发环境会自动创建 `game_rooms` 表，正式发布时会应用 `drizzle/` 中的迁移。

## 验证

```bash
npm run lint
npx tsc --noEmit
npm test
```

## 主要目录

- `app/GameClient.tsx`：首页、选牌、牌桌、结果、电脑与联机交互
- `lib/mahjong.ts`：牌型拆解、听牌、役种、番符、宝牌、振听和智能推荐
- `app/api/rooms/route.ts`：房间创建、加入、选牌、轮流舍牌与荣和
- `app/api/auth/route.ts` 与 `db/auth.ts`：邮箱注册、登录和安全会话
- `db/` 与 `drizzle/`：D1 房间状态和数据库迁移

## 参与贡献

欢迎从 [`good first issue`](https://github.com/glow404/17mah-jong/labels/good%20first%20issue) 开始参与。提交代码前请阅读 [贡献指南](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)；未修复的安全漏洞请按照 [安全策略](SECURITY.md) 私下报告。

项目采用 [MIT License](LICENSE)。版本变化记录在 [CHANGELOG.md](CHANGELOG.md)，开源成熟化计划记录在 [OPEN_SOURCE_ROADMAP.md](OPEN_SOURCE_ROADMAP.md)。
