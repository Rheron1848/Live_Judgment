# Live Judgment

检测与屏蔽B站直播的弹幕油猴脚本：自动识别直播间内的异常发言行为（独轮车刷屏、自动融入跟风、规避性复读、长文无关灌水），在聊天区直接标记可疑用户，提供其弹幕记录与违规档案，并支持本地屏蔽与官方快捷处置。

开发过程中使用了kimi-K3。

献给灰泽满Hazel。

## 功能概览

- **异常行为检测**：基于弹幕内容与发送时序识别四类模式——D1 独轮车复读（复读/固定节拍/轮播）、D2 不可见字符规避、D4 自动融入（只跟风不发起）、D8 长文无关刷屏；判定为概率性标记（类别 + 置信度 + 证据），应援类正常文化（打call、`[表情]`、`/名字/` 等）已豁免
- **用户标记**：被识别用户的弹幕在聊天区挂彩色徽章，悬停显示规则与置信度，点击徽章打开用户面板
- **弹幕记录与违规档案**：本地持久化（IndexedDB）弹幕历史；违规档案跨场次、跨房间累积，可见该用户在各主播直播间的历史记录；人工确认名单持久生效、入场即标
- **本地屏蔽**：自定义屏蔽词（按直播间归档 + 全局组，支持正则）与本地屏蔽此人（本房间 / 全局两级）——仅自己浏览器生效，被屏蔽弹幕照常进检测与记录
- **快捷处置**（依赖登录态，二次确认，永不自动执行）：官方屏蔽（个人级，服务端新会话生效）、拉黑（账号黑名单）、举报选中弹幕（唤出官方举报面板）；禁言需房管权限，无权限置灰

详细需求见 [`docs/requirements.md`](docs/requirements.md)，设计规格见 [`docs/specs/`](docs/specs/)。

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey 扩展
2. 到 [Releases](https://github.com/Rheron1848/Live_Judgment/releases) 下载最新 `live-judgment.user.js`，拖入扩展管理页安装（或新建脚本粘贴全部内容）
3. 打开 B 站直播页面（live.bilibili.com）即生效

注意：暂不支持自动更新，新版本需手动下载重装。

## 技术栈

- Bun + Vite + TypeScript，构建为单文件 userscript
- 运行环境：Tampermonkey / Violentmonkey，作用于 B 站直播页面

## 开发

```bash
bun install
bun run dev        # 开发服务器（5173），Tampermonkey 装开发版脚本即可热更新
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun test test/     # 单测（必须限定 test/ 目录）
bun run build      # 产物 dist/live-judgment.user.js
```

真实直播间无人值守验收（CDP 无头方案）见 [`tools/README.md`](tools/README.md)；发版流程见 [`docs/release.md`](docs/release.md)。

## License

[MIT](LICENSE)

---

# Live Judgment (English)

A userscript for Bilibili Live chat moderation: detects abusive messaging behaviors (repeat-spam loops, bandwagon-only auto-blend posters, invisible-character evasion, long off-topic flooding), flags suspicious users inline in the chat panel, keeps their danmaku history and cross-session violation records, and offers local muting plus official quick actions.

Kimi K3 was employed during development.

Dedicated to Hazel.

## Features

- **Behavior detection**: four rule families from message content and send timing — D1 repeat loops (repeat / fixed cadence / carousel), D2 invisible-character evasion, D4 bandwagon-only joining, D8 long off-topic flooding; verdicts are probabilistic (rule + confidence + evidence), with normal cheering culture exempted (打call, `[emote]`, `/name/`, etc.)
- **User flagging**: colored badges on flagged users' messages; hover for rule/confidence, click to open the user panel
- **History & records**: local persistence (IndexedDB) of danmaku history; violation records accumulate across sessions and rooms, showing a user's history in each anchor's live room; a manual watchlist persists and marks on sight
- **Local muting**: custom block words (per-room + global groups, regex supported) and per-user local mute (room / global scopes) — browser-local only; muted messages still flow into detection and records
- **Quick actions** (login required, double-confirmed, never automatic): official shield (personal, server-side on new sessions), block (account blacklist), report selected danmaku (opens the official report panel); silence requires moderator privileges and is disabled otherwise

See [`docs/requirements.md`](docs/requirements.md) (Chinese) for the full requirements and [`docs/specs/`](docs/specs/) for design specs.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey browser extension
2. Download the latest `live-judgment.user.js` from [Releases](https://github.com/Rheron1848/Live_Judgment/releases) and drag it into the extension's dashboard to install (or create a new script and paste the full contents)
3. Open any Bilibili Live page (live.bilibili.com) — the script activates automatically

Note: auto-update is not supported yet; new versions must be reinstalled manually.

## Tech stack

- Bun + Vite + TypeScript, built as a single-file userscript
- Runtime: Tampermonkey / Violentmonkey on Bilibili Live pages

## Development

```bash
bun install
bun run dev        # dev server (5173) with userscript hot reload
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun test test/     # unit tests (must scope to test/)
bun run build      # outputs dist/live-judgment.user.js
```

Unattended acceptance against real live rooms (headless CDP) is documented in [`tools/README.md`](tools/README.md); the release process is documented in [`docs/release.md`](docs/release.md) (Chinese).

## License

[MIT](LICENSE)
