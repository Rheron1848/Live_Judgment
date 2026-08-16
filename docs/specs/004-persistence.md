# 004 本地持久化（F4：弹幕记录 / 违规档案 / 人工名单）设计规格

- **日期**：2026-08-16
- **状态**：已定稿
- **来源**：`docs/requirements.md` F4（2026-08-16 拍板口径）；spec 002/003

## 背景与目标

落地本地持久化层（IndexedDB），支撑三件事：① 弹幕记录留存供回溯；② 违规档案跨场次/跨房间本地积累，含主播归属；③ 人工确认名单持久化、入场即标。本规格只覆盖**存储层 + 自动接线**；查看面板（点击徽章看档案、名单管理 UI）属下一个规格。成功标准：刷新页面后违规档案与名单仍在，名单用户一发言即被标记，主播名能解析展示。

## 已拍板决策

| # | 决策 | 拍板人 | 日期 |
|---|------|--------|------|
| 1 | 违规档案跨场次积累、人工名单持久跨房间生效、查看记录含主播归属 | 用户 | 2026-08-16 |
| 2 | 徽章触发口径：本场证据 + 人工名单；自动档案仅展示，不单独触发徽章 | 用户 | 2026-08-16 |
| 3 | 存储用 IndexedDB，不用 GM_setValue（数据量远超其适用场景） | AI（实现细节自主权内） | 2026-08-16 |
| 4 | 测试引入 `fake-indexeddb` devDep，存储层可在 bun test 中真实跑通 | AI（实现细节自主权内） | 2026-08-16 |
| 5 | incidents 默认永久保留，用户可手动清理（清理入口属查看面板规格）；仅 danmaku 按 7 天自动清理 | 用户 | 2026-08-16 |

## 设计

### IndexedDB schema（库名 `live-judgment`，v1）

| store | 键 | 索引 | 内容 |
|---|---|---|---|
| `danmaku` | 自增 id | `uid+ts`、`roomId+ts` | {uid, uname, text, roomId, ts} 原始弹幕记录 |
| `incidents` | 自增 id | `uid`、`ts` | {uid, uname, rule, confidence, evidence[], roomId, ts} 违规档案，一条判定一条记录 |
| `watchlist` | uid | — | {uid, uname, note?, addedAt, fromRoomId} 人工确认名单 |
| `rooms` | roomId | — | {roomId, anchorName, fetchedAt} 主播名缓存 |

### 写入策略

- **弹幕记录**：内存缓冲，每 2 秒或满 50 条批量写一次（高刷屏房间逐条写事务太贵）。
- **违规档案**：`onVerdict` 时立即写（量小）。
- **保留策略**：启动时清理 danmaku（默认保留 7 天）；incidents 默认永久保留（决策 5），用户可手动清理，清理入口属查看面板规格；常量化，配置项属 F7。

### 主播名解析（store/anchor.ts）

- 按需解析 roomId → 主播名：`GET xlive/web-room/v1/index/getInfoByRoom?room_id=`（页面同源、带 cookie），结果写 `rooms` 缓存；失败优雅降级为只显示房间号。
- 仅当某房间首次产生 incident 或用户查看记录时触发，不做无谓请求。

### 人工名单入场即标（接线）

- 启动时把 `watchlist` 全量读入内存 Set。
- 每条弹幕事件：uid 在名单中 → 直接打一枚「人工」徽章（独立配色/图标，title 显示备注与加入时间），与检测徽章并存。
- 名单的增删 UI 属下一规格（查看面板）；本期提供 store API `addToWatchlist / removeFromWatchlist / listWatchlist`。

### 目录结构

```
src/lib/store/
  db.ts         打开/升级 IndexedDB、保留策略清理
  danmaku.ts    弹幕记录：缓冲批量写、按 uid/room 查
  incidents.ts  违规档案：写入、按 uid 查
  watchlist.ts  人工名单：增删查 + 内存缓存
  anchor.ts     主播名解析与缓存
test/store/     基于 fake-indexeddb 的读写/保留策略/批量缓冲测试
```

### main.ts 接线顺序

启动：打开 DB → 清理过期 → 读名单入内存 → 启动弹幕源。事件流：ingest → 名单检查（命中即标）→ verdict 检查（命中即标）→ 弹幕入缓冲。onVerdict：补标 + 写 incident + 触发主播名解析。

## 明确不做（out of scope）

- 查看面板 / 自定义浮层（点击徽章看档案、名单管理 UI）——下一规格。
- 弹幕记录的检索 UI、导出。
- 保留策略与开关的用户配置（F7）。
- 跨设备同步（需求已定：纯本地）。

## 待决（OPEN）

- 无。

## 验收标准

- `bun test`（含 fake-indexeddb 存储测试）、typecheck、lint、build 全绿。
- 人工检查清单：
  1. 直播间触发一次判定 → 刷新页面 → 该用户违规档案仍可查（控制台/API 验证）；
  2. 通过 API 把人加入名单 → 刷新 → 其一发言立即出现「人工」徽章；
  3. 高刷屏房间 10 分钟无卡顿（批量写生效）；
  4. 主播名解析失败时降级显示房间号，不报错。
