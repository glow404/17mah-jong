# 部署、监控与故障处理手册

本文是 17mah-jong 的生产运维手册。部署者仍需在自己的 Cloudflare 账号中设置 D1、Worker 域名、通知接收人和权限；仓库不会保存真实账号 ID、数据库 ID 或 API Token。

## 观测架构

- Worker 为每次 HTTP 请求生成 UUID `X-Request-ID`，并把它带入 Vinext 请求和响应。
- Worker Logs 接收 JSON 结构化日志；关键事件为 `http.request`、`api.server_error`、`room.state_conflict`、`auth.anomaly`、`health.database_unavailable`、`maintenance.completed` 和 `maintenance.failed`。Wrangler 已关闭默认 invocation URL 日志，避免现有房间凭证位于 query string 时被平台请求日志收集。
- 可选的 Analytics Engine binding `ANALYTICS` 写入 `mahjong_operational_metrics` 数据集。HTTP 点包含路由标签、方法、状态类别、延迟和计数；定时任务每分钟采集未结束房间数与累计完局数。
- `/api/health` 执行真实的 D1 `SELECT 1`，数据库不可用时返回 503。它不暴露绑定值、SQL 错误文本或其他内部信息。
- 日志及指标不记录请求头、Cookie、请求体、邮箱、账号 ID、房间码、牌谱或 URL 查询参数。指标路由使用有限标签，避免把用户/牌局数据放进时间序列。
- 本地 Vinext/Vite 开发服务器可能自行打印完整请求 URL；分享本地日志前必须删除房间码、token 等 query 参数。Worker 生产 invocation URL 日志已关闭，但此设置不控制本地开发服务器输出。

Wrangler 已开启 Workers Logs 和 Analytics Engine。Analytics Engine 本地开发不可用时会跳过指标写入；监控不可用不得影响游戏请求。

Cloudflare 参考：[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Analytics Engine 写入](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)与[聚合函数](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/)。

## 查询指标

首次部署并有请求产生后，Cloudflare 会自动创建 Analytics Engine 数据集。可在 Cloudflare Analytics Engine SQL API / Grafana 查询：

```sql
SELECT
  blob2 AS route,
  SUM(_sample_interval) AS requests,
  quantileExactWeighted(0.50)(double1, _sample_interval) AS p50_ms,
  quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms,
  quantileExactWeighted(0.99)(double1, _sample_interval) AS p99_ms,
  SUMIf(_sample_interval, double3 >= 500) / SUM(_sample_interval) AS server_error_rate
FROM mahjong_operational_metrics
WHERE blob1 = 'http.request'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route
ORDER BY requests DESC
```

活跃房间和累计完局数取最近一次每分钟快照：

```sql
SELECT
  argMax(double2, timestamp) AS active_rooms,
  argMax(double3, timestamp) AS completed_matches
FROM mahjong_operational_metrics
WHERE blob1 = 'room.snapshot'
```

字段约定：HTTP 行的 `blob1..blob4` 依次为事件、路由、HTTP 方法、状态类别；`double1..double3` 依次为延迟毫秒、请求计数、HTTP 状态码。快照行的 `double2` / `double3` 分别为活跃房间数和累计完局数。上述查询应先在实际数据集上验证；无流量时百分位和快照自然为空。

## 告警配置

仓库会发出可检索的结构化事件，但通知渠道和阈值属于部署账号配置，不能从本仓库替账号创建。首次上线时在 Cloudflare Notifications / Workers Observability 配置接收人，并完成以下核对：

| 信号         | 事件/来源                                                        | 建议初始条件                                 |
| ------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| Worker 异常  | Workers Issues / `api.server_error`                              | 5 分钟内同类异常持续出现，通知值班人         |
| D1 故障      | `/api/health` 外部 uptime monitor、`health.database_unavailable` | 连续 2 次探针失败立即通知                    |
| API 错误率   | 上方 `server_error_rate` 查询、Cloudflare HTTP 5xx 通知          | 5 分钟窗口 > 2%，且至少 30 个请求            |
| 房间状态冲突 | `room.state_conflict`                                            | 5 分钟持续 > 5 次；先检查客户端版本/重试风暴 |
| 认证异常     | `auth.anomaly`，并结合 Cloudflare 安全事件                       | 5 分钟持续 > 20 次；不要把单次失败当攻击     |

门槛只是首发默认值，发布后根据流量和误报率校准。Workers Logs 的控制台通知是否支持按自定义 JSON 字段直接触发，取决于所用账号能力；若不支持，把 Worker Logs/Analytics Engine 通过 Logpush 或 SQL API 接到现有告警平台，不要在应用中硬编码账号 Token。401 和 409 会自然发生，告警应针对持续异常而不是逐条触发。

## 发布流程

1. 在目标分支执行 `npm ci`、`npm run ci`，确认代码、迁移和测试全绿。
2. 检查 `wrangler.jsonc` 中的 Worker 名称和 Analytics binding；用 `wrangler d1 info mahjong-db` 确认账号与目标数据库。真实 D1 ID 只能保存在部署配置，不要提交到公共模板。
3. 先将本次变更部署到 staging，执行 `npm run db:migrate:remote`（仅针对 staging 数据库），再部署 Worker。
4. 对生产环境先审查迁移和回滚影响，再执行 `npm run db:migrate:remote`，最后 `npx wrangler deploy`。
5. 验证 `GET https://<production-host>/api/health` 返回 200、响应包含 `X-Request-ID`；再手工完成游客对局和双浏览器联网对局。
6. Cloudflare Worker 的 Observability 页面应出现 JSON `http.request`；Analytics Engine 应能查到请求行和后续 `room.snapshot`。
7. 发布记录中写入 commit、Worker version、迁移编号、健康检查结果及发布人。渐进发布/版本流量分配取决于账号配置；不要把未经验证的版本直接宣称为已上线。

部署前准备账号和数据库的核验，参见 [README 的部署说明](../README.md#构建与部署)。远程 D1 操作必须确认当前 Wrangler 登录身份和数据库，禁止对未知目标执行迁移或恢复。

## 回滚流程

1. 若只是 Worker 代码故障而数据库兼容，优先在 Cloudflare Workers Deployments 中回滚到上一个已验证版本；再检查 `/api/health`、错误率和一局端到端流程。
2. 如果新版本依赖新增字段，确认旧 Worker 能安全读取迁移后的 schema。数据库迁移默认按向前兼容方式设计；不要把 Worker 回滚等同于 D1 schema 回滚。
3. 若数据库数据被误写/误删，先暂停写入或启用维护模式，保存当前时间和当前 bookmark，再按下方流程进行时间点恢复。
4. 恢复后重新验证身份认证、房间读取、历史回放和迁移版本；记录事故时间线、影响范围和恢复点。

## D1 备份与恢复

生产 D1 使用 Cloudflare Time Travel 前，先运行 `npx wrangler d1 info mahjong-db` 并确认数据库 `version: production`。Time Travel 无需启用，可恢复到保留期内的时间点；可用时间范围依 Cloudflare 计划而异。若数据库仍是旧 `alpha` 存储，则需遵循 Cloudflare 对旧版 snapshot backup 的文档，不能照搬 Time Travel 命令。详见 [D1 Time Travel 官方说明](https://developers.cloudflare.com/d1/reference/time-travel/)。

查看当前 bookmark 和指定事故前的 bookmark：

```bash
npx wrangler d1 time-travel info mahjong-db
npx wrangler d1 time-travel info mahjong-db --timestamp="2026-10-05T12:00:00Z"
```

恢复会覆盖生产数据库。在执行前：确认事故时间、数据库名称和目标 bookmark；保存当前 bookmark（它用于撤销恢复）；通知用户并暂停写入；由第二人复核目标。然后执行：

```bash
npx wrangler d1 time-travel restore mahjong-db --bookmark="<reviewed-bookmark>"
```

通过命令提示再次检查目标，恢复后进行上述完整验证。若恢复到错误位置，使用恢复命令返回的先前 bookmark 撤销。对于超过 Time Travel 保留期的长期归档，本仓库当前未配置 R2 导出，部署者须另行建立加密、访问控制和恢复演练方案，并明确保留期限。

至少每季度在隔离的 staging 数据库演练一次恢复。演练只可使用 staging 目标，不可用真实生产库做验证性恢复。

## 故障处理

### 数据库健康检查失败 / API 5xx

先通过 request ID 定位 `http.request` 与相邻日志；确认是否同时发生 Cloudflare D1 服务故障、部署/迁移或 binding 配置变化。检查 Worker 的 DB binding 和目标数据库，不要在日志或 Issue 中粘贴 Cookie、用户请求体或密钥。若事故由最近发布引入，先按代码回滚流程处理；若是数据损坏，按 Time Travel 流程恢复。

### 房间状态冲突突然升高

检查 `api.rooms` 的 409 比例、客户端版本和最近的重连/重试发布。409 可能是正常的旧版本拒绝，也可能是重复点击/并发动作；按 request ID 关联请求，不记录玩家凭证。必要时启用维护模式阻止新联机动作，先确保当前对局不会被重复提交覆盖。

### 认证异常升高

区分正常错误密码、限流和异常自动化流量；结合 Cloudflare Security Events、速率限制和源站错误率检查。不要尝试从匿名日志反查邮箱；若怀疑凭证泄露，按 [`SECURITY.md`](../SECURITY.md) 的私密漏洞流程处理。

### Cron 维护任务失败

检查 `maintenance.failed` 的时间、错误类型、D1 可用性和迁移状态。当前任务负责超时结算、离线判负/流局和过期房间清理；确认下一分钟成功完成前，监控过期房间和回合截止状态。必要时在修复后通过正常 Cron 触发，不要直接手工改写 JSON 房间状态。

## 性能基线与剖析

- 规则函数本地微基准：`npm run perf:rules`，报告听牌、计分逻辑 P50/P95/P99（微秒）。这适合比较同一机器/Node 版本上的改动，不是生产 SLO。
- 页面加载及网络往返：先运行应用，再执行 `PERF_BASE_URL=http://127.0.0.1:3000 npm run perf:baseline`（PowerShell 可用 `$env:PERF_BASE_URL='http://127.0.0.1:3000'`）。脚本用 Playwright 报告页面 load 和同源 `/api/health` 往返延迟的 P50/P95/P99；健康接口 RTT 是网络代理样本，不等同于已认证的房间轮询 RTT。
- 生产 API 延迟：用 Analytics Engine 查询按路由的 P50/P95/P99；记录时间窗口、流量、Worker 版本和地区/环境，避免将本地值与生产混为一谈。
- 联机同步：用双浏览器 E2E 在正常网络和 DevTools 弱网/高延迟条件下录制 trace，观察 `/api/rooms` 请求间隔、响应体、409 和交互后状态同步时间。规则引擎 `evaluateWin` / `waitTypes` 由本地基准覆盖；端到端牌桌必须同时观察客户端渲染及同步延迟。

每次规则/同步关键变更前后使用相同样本比较。建议记录环境、样本量和 P50/P95/P99；性能回归阈值需基于生产实测再设定，不以单机基线设全球承诺。
