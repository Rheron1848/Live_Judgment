# 001 脚手架与弹幕接入（F1）设计规格

- **日期**：2026-08-15
- **状态**：待评审
- **来源**：`docs/requirements.md` F1；2026-08-15 会话需求确认

## 背景与目标

落地可构建的油猴脚本脚手架，并打通最小链路：进入 B 站直播间 → 持续捕获聊天区弹幕（uid、昵称、内容、到达时间）→ 以结构化事件流出供后续检测模块消费。成功标准：`vite build` 产出单文件 userscript，装进 Tampermonkey 后打开任意直播间，控制台可见逐条弹幕事件日志。

## 已拍板决策

| # | 决策 | 拍板人 | 日期 |
|---|------|--------|------|
| 1 | 产物形态为 Tampermonkey / Violentmonkey 油猴脚本 | 用户 | 2026-08-15 |
| 2 | 技术栈 Bun + Vite + TypeScript + vite-plugin-monkey，单文件构建 | 用户 | 2026-08-15 |
| 3 | 弹幕接入首期走页面聊天区 DOM（MutationObserver），抽象 `DanmakuSource` 接口，后续可替换为弹幕 WebSocket 通道 | AI（实现细节自主权内） | 2026-08-15 |
| 4 | 不引入 UI 框架；后续标记渲染用原生 DOM + Shadow DOM 隔离样式 | AI（实现细节自主权内） | 2026-08-15 |
| 5 | lint/format 用 Biome（单依赖覆盖两者） | AI（实现细节自主权内） | 2026-08-15 |

## 设计

### 弹幕接入选型（决策 3 的依据）

- **DOM MutationObserver**：监听聊天容器 `.chat-items`，从每条弹幕节点的 `data-uid` / `data-uname` / `data-danmaku` 属性提取字段。优点：零额外连接、与页面登录态天然一致、实现已被实践验证。缺点：聊天区有 DOM 裁剪（消息多了旧节点被移除），高刷屏房间可能丢消息；到达时间受页面渲染节奏影响。
- **弹幕 WebSocket（blive 协议）**：独立连接，消息不经过页面渲染，不丢、时序精确。缺点：需实现二进制分包/心跳/鉴权，工作量大一个量级。

首期取 DOM 方案求快求稳，把丢消息问题留给 WS 通道（见待决 1）。接口先行抽象，替换通道不影响检测与展示模块。

### 模块划分

```
src/
  main.ts                 入口：页面判定、启动源、临时控制台输出
  lib/
    types.ts              DanmakuEvent（uid/uname/text/ts/roomId/raw）
    danmaku-source.ts     DanmakuSource 接口（start/stop/onMessage）
    dom-chat-source.ts    MutationObserver 实现
    room.ts               从 URL 解析房间号
```

### 构建

- vite-plugin-monkey 输出 `dist/live-judgment.user.js`；`@match *://live.bilibili.com/*`；`run-at: document-idle`；`@grant` 仅按需申请（本期不需要 GM_* API）。
- npm scripts：`dev`（vite 开发模式）、`build`（tsc + vite build）、`typecheck`（tsc --noEmit）、`lint`（biome check）。

## 明确不做（out of scope）

- 任何检测规则（D1–D7）、标记渲染、设置面板、数据持久化——后续 spec 覆盖。
- 弹幕 WebSocket 通道的实现（仅留接口）。
- GM_xmlhttpRequest、跨域请求、`@connect` 声明。

## 待决（OPEN）

- **待决 1**：高刷屏房间 DOM 裁剪导致的消息丢失是否可接受？候选口径：a) 接受，DOM 裁剪只丢最旧消息，检测窗口内的消息通常仍在；b) 提前实现 WS 通道。倾向 a，待用户拍板。
- **待决 2**：`data-danmaku` 等 DOM 属性属于页面内部结构，B 站改版会导致解析失效。候选口径：a) 接受，失效后修选择器；b) 直接上 WS 协议规避页面耦合。倾向 a，与待决 1 联动。

## 验收标准

- `bun run typecheck`、`bun run lint`、`bun run build` 全绿。
- 构建产物为单文件 userscript，含正确的 userscript 元信息头。
- 人工检查清单：Tampermonkey 安装产物 → 打开任意 B 站直播间 → 控制台逐条输出弹幕事件（uid/昵称/内容/时间正确）→ 切换直播间页面无报错。
