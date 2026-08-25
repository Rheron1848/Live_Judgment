# 011 D0 手动复读淡标 + 判定退出机制 + 检测批处理性能优化 设计规格

- **日期**：2026-08-25
- **状态**：已实现（2026-08-25：typecheck + 69 单测 + build 全绿；真实直播间目视验收待用户刷新后确认）
- **来源**：2026-08-25 用户三连问后的拍板——「D1 做退出」「手动复读改淡淡的 D0（设置里可选不挂）」「性能优化，一定时间处理一批而不是即时处理」

## 背景与目标

现状两痛点（代码审计结论，见对话记录）：

1. D1 无退出机制：`verdicts` 只升不降，手动复读党吃 medium 徽章直到页面刷新；项目定位是「只针对自动化独轮车」。
2. 性能热点：每条新弹幕对全局窗口（60s、无条数上限）全量 `normalizeText` + D8 全量排序，火爆房间会卡主线程；内存结构只增不减。

## 已拍板决策

| # | 决策 | 拍板人 | 日期 |
|---|------|--------|------|
| 1 | D1 判定做退出（衰减）机制 | 用户 | 2026-08-25 |
| 2 | 手动复读（仅复读单信号）降级为淡色 D0 徽章，设置里可关 | 用户 | 2026-08-25 |
| 3 | 检测改批处理（定时间隔处理一批），做 normalize 缓存等性能优化 | 用户 | 2026-08-25 |
| 4 | D0/D1 在 verdict 层同源互斥：D1 成立时 D0 摘除，D1 在案时忽略后续 D0 | AI 申报（实现期发现，否则批处理与逐条语义无法对齐） | 2026-08-25 |

## 设计要点

### D0 规则（疑似手动复读）

- `RuleId` 新增 `'D0'`。`checkRepeatLoop` 产出语义：
  - 唯一信号是「复读」→ 产 **D0** hit（confidence: medium）——人类手动复制粘贴的典型形态。
  - 其余组合（含节拍或轮播）→ 产 **D1** hit：≥2 信号 high，单信号 medium。自动化特征不变。
- D0/D1 互斥（一次评估只产其一）；规则门控按 hit.rule 过滤，D0、D1 可独立开关。
- 徽章：D0 灰色（`#888`）、非实心淡色（沿用 `lj-badge--soft`），title 注明「手动复读嫌疑」。
- 设置：规则开关新增 D0（**默认开**），标签注明「淡色提醒，可关闭」；`RULE_IDS` / `defaultSettings.rules` / 面板规则列表 / `RULE_NAMES` 同步加 D0。
- D0 命中照常落 incidents 档案（统一路径，档案语义 = 发生过什么，含嫌疑）。

### 判定退出（衰减）

- `DetectConfig` 新增 `verdictDecayMs`（默认 5 分钟；代码内常量，不进设置 UI）。
- 引擎内部记录 `Map<uid, Map<rule, lastSeenAt>>`，每次命中（含同级刷新证据）刷新。
- 新增 `engine.sweep(now)`：移除 `lastSeenAt` 超过 `verdictDecayMs` 的 hit；
  - 该用户 hits 空 → 删除 verdict，以 **`hits: []` 的 verdict 通知 listener**（语义 = 判定退出，摘徽章）；
  - hits 减少（部分退出/降级）→ 同样通知，徽章重绘。
- main.ts：每 60s 调 `sweep`；onVerdict 收到空 hits → 调新增的 `unmarkAuto(uid)`（对称 `unmarkManual`；两槽皆空时一并移除 `lj-marked` 整条高亮类）。
- **档案不受影响**：已落库 incidents 保留（徽章退出 ≠ 抹除历史）；会话内 `recorded` 去重集合保留。

### 批处理与性能

- 引擎 API：新增 `ingestBatch(events)`；`ingest(e)` 保留 = 单元素 batch（既有测试/语义兼容）。
- **normalize 缓存**：batch 入口对每个事件算一次 `normalizeText`，以 `NormalizedEvent = DanmakuEvent & { norm }` 入用户/全局窗口；D1/D4/D8 全部改用 `e.norm`，消除全窗口重复 normalize。D2 仍用原文（检测对象就是原始字符）。
- batch 内顺序：逐事件入窗 + D2 → D4 逐事件（状态保序）→ **D8 全局统计每批算一次**（长度数组 + 中位数）→ D1/D8 按 touched uid 各评估一次。
- 全局窗口加条数上限 1000（`SlidingWindow` 第二参数，常量）。
- **GC**（sweep 顺带）：`SlidingWindow` 加 public `prune(now)`；空用户窗口删除；`BandwagonTracker.prune(now)` 删过期趋势。
- main.ts：事件回调只留即时便宜操作（落库缓冲、屏蔽词/屏蔽人隐藏、人工名单标记）；检测入队，**每 1000ms flush** → `ingestBatch` → 对批次内有 `el` 的事件按 `getVerdict` 补徽章。徽章出现延迟 ≤1s，可接受（用户拍板批处理）。

### 已知行为差异（申报）

- 逐条处理时代码会先记 medium 档案再记 high；批处理后同批内只评估最终态，**中间态档案不再产生**（更少更准，不算回归）。
- D0 语义使两个既有测试改断言：「第 3 条同文本到达先给中置信」「豁免文本夹带复读广告判 D1」→ 均改为期望 D0。

## 明确不做（out of scope）

- 衰减时长、批处理间隔、全局窗口上限不进设置 UI（常量 + 注释，后续有需求再开放）。
- D4 的 stats / trends 跨场次持久化。
- 判定的手动「误报解除」按钮（衰减机制已覆盖主要场景）。

## 验收标准

- 测试先红后绿：D0 产出与淡色徽章、sweep 退出通知（空 hits）、ingestBatch 与逐条等价、norm 缓存不改行为。
- `bun run typecheck` / `bun test test/` / `bun run build` 全绿（lint 因本机 CRLF 全红，为已知环境问题，另行处理）。
- CDP 真实直播间验收留待用户刷新后目视：手动连刷 3 条 → 淡 D0；脚本式节拍复读 → D1；停止后约 5 分钟徽章消失。
