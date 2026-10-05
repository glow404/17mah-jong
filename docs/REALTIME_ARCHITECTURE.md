# 联机可靠性与实时通信决策

## 当前选择

当前联机保留 HTTP + D1 作为单一权威数据源，不在这一迭代直接引入 WebSocket 或 Durable Objects。每桌只有两位玩家，动作频率低，主要复杂度来自断线恢复、重复命令和超时结算，而非消息吞吐。轮询改为串行、立即同步、带指数退避的重连，并在窗口重新聚焦或网络恢复时立即拉取快照；房间凭证保存在当前标签页的 `sessionStorage`，支持刷新恢复。

命令请求带客户端操作 ID 和观察到的房间版本。服务端先识别最近已处理的 ID，再验证版本，并在 D1 的版本条件更新中提交新状态；因此网络重试不会再次舍牌，并发旧快照不能覆盖较新状态。

## 方案比较

| 方案                                           | 优点                                                                                                  | 代价与适用条件                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 当前 HTTP 快照轮询                             | 复用现有 Workers Route Handler / D1 / Cookie 鉴权；自动重连简单；低频双人牌局成本可预测               | 更新有轮询延迟；每个客户端持续发读请求；需退避、心跳和版本冲突处理                                                               |
| Worker 直接 WebSocket                          | 双向推送、低延迟                                                                                      | 单个 Worker 内存不是持久房间协调器；多实例间还需共享协调层；断线重连后必须从持久化状态恢复                                       |
| 每房间 Durable Object + Hibernatable WebSocket | 单房间强一致协调、连接事件和 alarm 可用；WebSocket 空闲时可休眠；可把行动和定时器放在同一串行权威对象 | 新增 binding / migration / 本地模拟与监控；房间状态从 D1 JSON 重构；需处理部署重启、socket 重连、DO 存储版本和 D1 账号数据的边界 |

Cloudflare 文档建议服务器端 WebSocket 使用 Hibernation API；DO alarms 支持每个对象设置一个定时 alarm，可在回调中处理截止时间并安排下一个任务。若后续要低延迟观战、聊天、公开匹配或更高活跃房间数量，应优先试点“每个房间一个 Durable Object + Hibernatable WebSocket”，账号和会话仍放 D1；DO 成为实时牌局状态唯一权威，D1 只保留账户、审计或可恢复快照。不要同时允许 API 和 DO 各自写同一份牌局状态。

参考：[Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[Hibernation WebSocket 示例](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)、[Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)。

## 客户端版本和维护

- 请求携带 `X-Game-Protocol`；新客户端从 `lib/contracts/protocol.ts` 读取当前版本。
- 只增加可选字段或兼容行为时维持协议版本。破坏性请求/响应变更时先部署能同时接纳旧、新版本的服务端，再发布新客户端；确认旧版本退出后，提高 `MIN_GAME_PROTOCOL`。低于最低版本返回 HTTP 426，客户端显示刷新/更新提示。
- `MAINTENANCE_MODE=true` 时联机 API 返回 HTTP 503、`Retry-After` 和稳定错误码；电脑对战不依赖联机 API，仍可使用。
- 这两个变量是非敏感运行配置；生产环境通过 Worker 环境变量设置，仓库内只保留关闭维护和协议 v1 的开发默认值。

## 超时、掉线与清理

服务端时间为唯一依据。每个有效动作重置当前决策截止时间；客户端心跳只用于判断可达性，不改变牌局版本。超时和断线状态应由服务端的周期任务最终结算，即使双方都不再轮询也能完成；收到迟到动作时，先结算已过期状态再拒绝动作。房间 TTL 只用于删除已过期的等待、结束或长期无活动记录，不能代替牌局超时。

当前部署采用 Workers Cron Trigger 运行轻量清理/到期扫描。若迁移到每桌 Durable Object，则用 DO alarm 驱动单房间回合截止，Cron 只负责低频全局孤儿记录清理。
