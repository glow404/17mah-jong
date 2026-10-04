# Changelog

本文件记录 17mah-jong 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## Unreleased

### Added

- MIT 许可证、贡献指南、行为准则和安全策略。
- GitHub Issue Forms、Pull Request 模板及社区贡献标签。

## 0.1.0 - 2026-10-04

### Added

- 从 34 张个人牌池选择 13 张听牌的二人麻将核心流程。
- 从剩余 21 张牌中自由选择舍牌，并在双方各舍出 17 张后流局。
- 双立直、宝牌、里宝牌、振听及满贯以上荣和结算。
- 电脑对战和基于六位房间码的联网对战。
- 邮箱密码注册、PBKDF2 密码派生和 HttpOnly 会话 Cookie。
- 对手荣和后的手牌、荣和牌和里宝牌展示。
- 麻将图案牌面、背景音乐、舍牌和荣和音效。
- Cloudflare Workers、D1、Drizzle ORM 部署结构。
- 核心规则测试、ESLint、TypeScript 类型检查和生产构建验证。

### Changed

- 将项目整理为独立公开仓库并采用 Conventional Commits。
- 统一仓库文本文件为 LF，并排除缓存、构建产物和本地数据库。
