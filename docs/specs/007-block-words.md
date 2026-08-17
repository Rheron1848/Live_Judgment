# 007 F6 用户自定义屏蔽词 设计规格

- **日期**：2026-08-17
- **状态**：待评审
- **来源**：`docs/requirements.md` F6（2026-08-17 用户澄清口径：核心是用户自定义屏蔽词，仅自己看不到命中弹幕）

## 背景与目标

让用户维护一份**本地屏蔽词表**，命中词条的弹幕只在自己浏览器里隐藏（`display:none`），不影响他人、不调用任何 B 站写接口。词条按**直播间归档 + 全局组**两级组织，跨场次持久，支持正则。成功标准：合成用例单测覆盖匹配器全部分支；面板可增删词条并即时生效（在屏弹幕同步隐藏/恢复）；真实直播间 CDP 验收。

## 已拍板决策

| # | 决策 | 拍板人 | 日期 |
|---|------|--------|------|
| 1 | F6 核心是**用户自定义屏蔽词**，仅本地隐藏，不动官方接口 | 用户 | 2026-08-17 |
| 2 | 词条按直播间（roomId）归档 + 全局组，跨场次持久 | 用户 | 2026-08-17 |
| 3 | 支持正则 | 用户 | 2026-08-17 |
| 4 | 读取官方房间屏蔽词（`get_shield_info`）仅作参考展示，本期不做 | 用户（定为次要项） | 2026-08-17 |
| 5 | 隐藏只是视觉层：被屏蔽弹幕**照常进检测引擎与落库**（屏蔽 ≠ 放过违规） | AI（实现细节自主权内） | 2026-08-17 |
| 6 | 非法正则降级为字面包含匹配并 `console.warn`，不报错中断 | AI（实现细节自主权内） | 2026-08-17 |

## 设计

### 存储（`src/lib/store/blockwords.ts`）

- IndexedDB 新增 object store `blockwords`：`{ id?: number, word: string, isRegex: boolean, roomId: number }`，`roomId = 0` 表示全局组（IndexedDB 索引键不宜用 null，用 0 约定）；索引 `room` on `roomId`。
- `db.ts`：`DB_VERSION` 1 → 2，`onupgradeneeded` 做增量迁移（`oldVersion < 2` 时补建 store），已有数据保留。
- API：`listBlockWords(db)` / `addBlockWord(db, entry)` / `removeBlockWord(db, id)`。
- 持久化不可用时降级为会话级内存表（与 watchlist 同款降级）。

### 匹配器（`src/lib/blockword/matcher.ts`，纯函数）

- `compileBlockWords(entries, currentRoomId)`：取全局组（roomId=0）∪ 当前房间组（roomId=currentRoomId），编译为 `matcher.test(text): boolean`。
- 普通词条：`text.includes(word)`（大小写不敏感，弹幕场景无所谓大小写）。正则词条：`new RegExp(word, 'i')`，编译失败按决策 6 降级。
- 其他房间的词条不参与匹配（跨房间语义可能相反，如主播梗）。

### 隐藏层（`src/lib/mark/hide.ts`）

- `hideElement(el)` / `unhideElement(el)`：加/移除 `lj-hidden` 类；样式 `.lj-hidden { display: none !important; }` 并入 `marker.ts` 的注入 CSS。
- `reapplyHiding(matcher, root)`：遍历在屏 `.chat-item.danmaku-item`，按 `data-danmaku` 重读文本逐条重判（词条变更后调用，恢复不再命中的、隐藏新命中的）。

### 接线（`main.ts`）

- 启动时 `listBlockWords` → 建 matcher → 对已在屏弹幕 `reapplyHiding` 一次。
- `source.start` 回调内：`matcher.test(event.text)` 命中则 `hideElement(event.el)`；引擎 `ingest` 与落库照常（决策 5）。

### 面板（`panel.ts` 第三页签「屏蔽词」）

- 分组列出：当前房间（含房间号）+ 全局；每条约词文本（正则词条带 `regex` 标记）与删除按钮。
- 添加表单：词文本输入、正则勾选、作用域选择（本房间 / 全局）。
- 增删后经 `onBlockWordsChanged` 回调重建 matcher 并 `reapplyHiding`，即时生效。
- `PanelContext` 扩展：`listBlockWords()` / `addBlockWord(entry)` / `removeBlockWord(id)`。
- Tampermonkey 菜单加「Live Judgment 屏蔽词管理」入口。

### 测试（`test/blockword/`，先红后绿）

- 普通词命中/不命中；大小写不敏感。
- 正则命中；非法正则降级为字面包含。
- 作用域：全局 + 当前房间参与匹配，其他房间词条不参与。
- 空表不隐藏任何文本。

## 明确不做（out of scope）

- 读取/展示官方房间屏蔽词（`get_shield_info` 侦察成果留档备用，后续单独立项）。
- 屏蔽命中计数/提示条（「已隐藏 N 条」之类的 UI）。
- 词条导入导出。
- 按用户屏蔽（那是 watchlist + F5 的职责）。

## 待决（OPEN）

- 无。

## 验收标准

- `bun test`（含上述用例，先红后绿）、typecheck、lint、build 全绿。
- CDP 真实直播间：加一条全局屏蔽词 → 命中弹幕从聊天区消失、其余不受影响；删除后恢复。
