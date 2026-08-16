# Live Judgment

B 站直播弹幕治理油猴脚本：自动识别直播间内的异常发言行为（独轮车刷屏、自动融入跟风、规避性复读等），在聊天区直接标记可疑用户，提供其弹幕记录，并支持快捷举报 / 拉黑 / 禁言与屏蔽词过滤。

## 功能概览

- **异常行为检测**：基于弹幕内容与发送时序识别独轮车（定时重复刷屏）、自动融入（只跟风不发起）、不可见字符规避、语义改写复读等模式
- **用户标记**：在直播间聊天区对被识别用户做可视标记
- **弹幕记录**：查看被标记用户的弹幕历史
- **快捷处置**：一键举报 / 拉黑 / 禁言（依赖登录态与房管权限）
- **屏蔽词过滤**：结合直播间屏蔽词，隐藏或处理命中言论

详细需求见 [`docs/requirements.md`](docs/requirements.md)。

## 技术栈

- Bun + Vite + TypeScript，构建为单文件 userscript
- 运行环境：Tampermonkey / Violentmonkey，作用于 B 站直播页面

## 开发

脚手架尚未落地，验证命令将补充于此（typecheck / lint / build）。

## License

待定 / TBD

---

# Live Judgment (English)

A userscript for Bilibili Live chat moderation: automatically detects abusive messaging behaviors in live rooms (repeat-spam "wheelbarrow" loops, auto-blend bandwagoning, evasion-style reposts), flags suspicious users inline in the chat panel, shows their danmaku history, and offers one-click report / block / mute plus keyword-based filtering.

## Features

- **Behavior detection**: identifies repeat-spam loops, bandwagon-only posters, invisible-character dedup evasion, and paraphrase reposting from message content and send timing
- **User flagging**: visual markers on flagged users directly in the live chat panel
- **Message history**: browse a flagged user's danmaku history
- **Quick actions**: one-click report / block / mute (requires login and, for mute, moderator privileges)
- **Keyword filtering**: hide or act on messages hitting the room's block-word list

See [`docs/requirements.md`](docs/requirements.md) (Chinese) for the full requirements.

## Tech stack

- Bun + Vite + TypeScript, built as a single-file userscript
- Runtime: Tampermonkey / Violentmonkey on Bilibili Live pages

## Development

Scaffolding not yet in place; verification commands (typecheck / lint / build) will be documented here.

## License

TBD
