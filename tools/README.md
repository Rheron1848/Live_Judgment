# CDP 无头验收工具

在真实直播间对构建产物做无人值守验收：无头 Chrome（不渲染、不解码视频）+ CDP 注入脚本 + 控制台/异常捕获 + DOM 探针 + 截图。无第三方依赖，Bun 原生 WebSocket 直连 CDP。

## 适用场景

- 验证真实消息流下的 观察器 → 检测 → 徽章 → 落库 全链路
- 复现/归因用户报的控制台报错（堆栈指向谁就是谁）
- 视觉验收截图（徽章、面板在真实页面的样子）

## 前提

- `bun run build` 产出 `dist/live-judgment.user.js`（脚本注入的是这个文件，改代码后要重新 build）
- 本机有 Chrome

## 快速开始

```bash
# 1. 起无头 Chrome（不登录，公开数据场景）
google-chrome --headless=new --disable-gpu --mute-audio --no-first-run \
  --disable-extensions --remote-debugging-port=9222 \
  --user-data-dir=/tmp/lj-profile about:blank &

# 2. 跑工具
bun tools/cdp-capture.ts "https://live.bilibili.com/510" 120   # 控制台/异常捕获 N 秒
bun tools/cdp-probe.ts "https://live.bilibili.com/510" 45      # DOM 诊断 + 截图 /tmp/lj-page.png
```

## 需要登录态时（如验证人机验证之后的真实弹幕流）

Chrome 136+ 禁止默认 profile 开调试端口，所以用**最小副本**（cookie 解密依赖本机已解锁的系统钥匙串，同机同用户有效）：

```bash
mkdir -p /tmp/lj-profile/Default
cp ~/.config/google-chrome/"Local State" /tmp/lj-profile/
cp ~/.config/google-chrome/Default/Cookies{,-journal} /tmp/lj-profile/Default/
# 然后用 --user-data-dir=/tmp/lj-profile 起无头 Chrome
```

**安全纪律**：副本等于登录凭据。不读取、不打印 cookie 内容；用完 `rm -rf /tmp/lj-profile` 并杀掉无头进程（`pkill -f remote-debugging-port=9222`）。

## 脚本

| 脚本 | 用途 |
|---|---|
| `cdp-capture.ts <url> [秒]` | 控制台与未捕获异常捕获，收尾探针报 chatItems/徽章/IndexedDB 计数 |
| `cdp-probe.ts <url> [秒]` | DOM 诊断（容器/iframe/页面文本）+ 截图 `/tmp/lj-page.png` |
| `cdp-simulate.ts <url>` | ~~往聊天容器注入合成弹幕~~ 已弃用（拍板：无风险场景一律用线上真实数据），仅存档 |

通用行为：启动即屏蔽视频流（`bilivideo.com/.m4s/.flv/.mp4`），视频不下载不解码；聊天 DOM 与弹幕推送不受影响。副作用是播放器重试刷日志（`play error` / `RTCPeerConnection`），归因时注意这不是我们的代码。

## 踩坑记录

- **聊天容器两种形态**：标准房间 `.chat-items` 在顶层文档；赛事/活动页嵌在 `/blanc/<房间号>` iframe 里。探针和注入都必须兼容两种（脚本内有 `CHAT_DOC` 模式）。Tampermonkey 场景靠 `@match *://live.bilibili.com/*` 天然覆盖 iframe。
- **未登录无头客户端会被人机验证挡住**：容器在、消息不来。解法只有带登录态。
- **document-start 时序**：`Page.addScriptToEvaluateOnNewDocument` 注入极早，`document.body` 为 null——源码里已做 `documentElement` 兜底，新写 DOM 代码注意同样问题。
- **报错归因看堆栈**：B 站页面自身日志量很大（播放器、Vue、AI Gift 等），我们代码的判断依据是堆栈是否指向注入脚本。
