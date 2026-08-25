# 008 F5 快捷处置（举报 / 拉黑 / 禁言）设计规格

- **日期**：2026-08-18
- **状态**：待评审
- **来源**：`docs/requirements.md` F5；spec 005（查看面板）；2026-08-17 接口侦察存档

## 背景与目标

在面板的用户页给被标记用户提供一键处置入口：**拉黑**（加入 B 站个人黑名单）、**禁言**（直播间禁言，需房管/主播权限）、**举报**（向平台举报）。与纯本地的标记/屏蔽不同，这三个动作通过用户的登录态调用 B 站写接口，**对外生效、影响他人账号**，是本脚本第一个写操作功能。

## 已拍板决策

| # | 决策 | 拍板人 | 日期 |
|---|------|--------|------|
| 1 | 提供举报、拉黑、禁言三类处置，依赖用户登录态 | 用户（原始需求） | 2026-08-15 |
| 2 | 处置按钮放进面板用户页，不单独做 UI 入口 | AI（沿用既有面板） | 2026-08-18 |
| 3 | `shield_user` 定性为**个人级官方屏蔽**（人人可用，非房管工具；用户确认官方直播页普通观众即有「屏蔽」入口），纳入本功能个人处置区 | 用户 | 2026-08-18 |
| 4 | **命名约定**：本地动作一律带「本地」前缀（本地屏蔽此人/本地屏蔽词），官方动作用具体名（官方屏蔽/拉黑/禁言），杜绝「屏蔽」一词两层含义混用 | 用户 | 2026-08-18 |

### 动作分区（按决策 3/4 修正后的地图）

- **个人处置**（登录即可）：官方屏蔽（`shield_user`，可逆）、拉黑（账号黑名单）、举报
- **房管处置**（需房管/主播，无权限置灰）：禁言（`user_silent`）
- **本地动作**（无登录要求，不在本规格）：本地屏蔽词（spec 007）、本地屏蔽此人（spec 009）

## 设计要点

### 接口实测（2026-08-24 CDP 登录态侦察，房间 21756924；本节原名「接口候选」）

> 共性：POST 表单 + `csrf`/`csrf_token`（取自 cookie `bili_jct`）+ cookie 登录态；错误处理一律透传 B 站返回的 `message`。旧候选 → 实测结论的差异逐条标注。

#### 1. 官方屏蔽 shield_user（个人级，可逆）——已实测闭环

- **请求**：`POST https://api.live.bilibili.com/liveact/shield_user`，表单 `{uid, roomid, type, visit_id:'', csrf, csrf_token}`；`type=1` 屏蔽、`type=0` 解除。
- **响应**：`{"code":0,"msg":"","message":"","data":{"uid":<uid>,"uname":<昵称>}}`（屏蔽与解除均实测 code=0）。
- **效果实测**：屏蔽后**已建立的弹幕会话不受影响**（75s 内仍见目标 4 条）；**重连/刷新后完全生效**——新会话 75s 内 244 条消息中目标 0 条，历史快照也不含目标。即服务端按会话过滤推送与历史。
- **读回接口已失效**：`/liveact/get_shield_info`（GET/POST）、`/msg/get_shield_info`、`/xlive/web-ucenter/v1/get_shield_info` 分别返回 `WebProxyNeedLess` / 404。官方屏蔽列表无可用 web 读路径 → **面板状态需本地乐观维护**（或依赖屏蔽/解除的幂等性）。
- 旧候选「`POST /liveact/shield_user`」→ 实测确认格式正确；「`get_shield_info` 确认 `shield_user_list`」→ 不可行，读接口已死。

#### 2. 拉黑（账号黑名单）——官方 bundle 证实格式，未真发

- **请求**：`POST https://api.bilibili.com/x/relation/modify`，表单 `{fid:<uid>, act, re_src, gaia_source:'web_main', spmid, csrf}`。act 枚举（官方 space bundle `fresh-space/assets/index-*.js` 实测反解）：`ADD_FOLLOW=1 / CANCEL_FOLLOW=2 / QUIET=3 / CANCEL_QUIET=4 / BLOCK=5（拉黑）/ CANCEL_BLOCK=6（解除拉黑）/ DEL_FANS=7`。
- **读**：`GET https://api.bilibili.com/x/relation/blacks?pn=1&ps=N`（登录），实测 code=0，`data.list[].attribute=128` 即拉黑状态（与枚举 `BLOCK=128` 对应），可作「已在黑名单」的置灰/切换依据。
- 注意：直播间 bundle 只用 act 1/2（关注/取关），直播 web UI 无拉黑入口——这是主站通用接口；实测可从直播页 fetch 上下文直接调 `api.bilibili.com`（未被 CSP 拦）。
- 旧候选「`x/relation/modify` act=5」→ 证实，解除为 act=6。

#### 3. 举报——弹幕级举报已实测锁定（2026-08-24 补）；直播间级举报留档

> 旧结论（同日早些时候）「直播 web 无针对单条弹幕/单个观众的举报 UI」→ **被用户实测指正并侦察推翻**：入口在弹幕菜单里，不是房间页「举报」按钮。以下 3a 为弹幕级（F5 正解），3b 为直播间级（留档，非 F5 目标）。

##### 3a. 举报选中弹幕（针对单条弹幕/单个观众）——已实测，未提交

- **入口**：聊天区点用户名（或右键弹幕）→ `.danmaku-menu` 菜单 → 「举报选中弹幕」→ 页内弹出 `.danmaku-report-panel` 面板（非 iframe；面板显示目标昵称 + 弹幕原文 + 理由下拉 + 确认/取消）。
- **理由枚举**：`GET https://api.live.bilibili.com/xlive/web-ucenter/v1/dMReport/ForReason`（打开面板时由官方前端调用），实测响应 `code=0`，`data.data` 固定 7 项：`{1:违法违规, 2:低俗色情, 3:垃圾广告, 4:辱骂引战, 5:政治敏感, 6:青少年不良信息, 7:其他}`。
- **提交接口**：`POST https://api.live.bilibili.com/xlive/web-ucenter/v1/dMReport/Report`，`application/x-www-form-urlencoded`。实测完整表单（选「违法违规」后点确认，请求在 Fetch 层 abort、未出网卡，**未产生真实举报**）：
  - `id=0`；`roomid=<房间号>`
  - **`tuid=<目标观众 uid>`（目标标识字段）**
  - `msg=<弹幕原文>`；`reason=<理由文本>`；**`reason_id=<1-7>`（与 ForReason 枚举对应）**
  - `ts=<秒级时间戳>`；`sign=<8 位 hex>`（前端按内容计算的签名，算法未反解——实现风险点，见下）
  - `dm_type=1`；`id_str=<32 位 hex 弹幕唯一 id>`；`file_id=room_<roomid>_<数字>`；`token=`（空）；`visit_id=`（空）
  - `img_url=<表情图 URL>`（被举报的是表情弹幕时有值；文本弹幕预计为空或省略）
  - `csrf` / `csrf_token`（bili_jct）
- **实现风险点**：`sign`（8 位 hex，疑似 msg/ts 的摘要）与 `id_str`（弹幕 id，WS 推送里的 dmid，DOM 的 `data-*` 不直接暴露）两个字段需要进一步反解或从弹幕推送数据获取；UI 复刻官方面板可行，但提交字段不一定能纯从前端状态凑齐——实现前需立项验证 `sign` 算法与 `id_str` 来源。

##### 3b. 举报直播间/主播（留档，非 F5 目标）

- 入口：房间页「举报」按钮 → iframe `https://live.bilibili.com/p/html/bilili-page-user-report/index.html#/reason`。
- 类型枚举：`GET /xlive/web-ucenter/v1/report/GetReportPageInfo?room_id=<id>`，实测 code=0，`data.tags` 固定 12 项（违法违规/色情低俗/色情引流/侵权盗播/录像挂播/封面党标题党/引人不适/对立争议/未成年相关/虚假宣传/引导私下交易/其他）。
- 提交：`POST /xlive/xroom-extend/report/SendReport`，表单 `{room_id, report_tag, report_reason, pic_url(可空), play_stream, live_from}`；成功判定 `code===0 && data` 非空。
- 待决 2 → 已解且语义修正：F5「举报该用户」有官方对应路径（3a），UI 用固定下拉（7 项理由）。

#### 4. 禁言（房管）——无权限实测

- **现行端点**：`POST https://api.live.bilibili.com/xlive/web-ucenter/v1/banned/AddSilentUser`，表单 `{room_id, tuid, mobile_app:'web', type:1, hour（-1 永久，或小时数）, csrf}`。**无权限实测**：`{"code":100004,"message":"你不是房管哦"}`。
- 配套（均 POST，房管）：解除 `…/banned/DelSilentUser` `{tuid, room_id, mobi_app:'web'}`；列表 `…/banned/GetSilentUserList` `{room_id, ps}`；房间级 `POST /xlive/web-room/v1/banned/RoomSilent`（未测）。
- 旧候选「`POST /liveact/user_silent`」→ 端点存活但参数校验先于权限（hour=±1 均回 `code:1 参数错误`），**弃用，改用 AddSilentUser**。

#### 5. 顺带修正：get_shield_info 的 shield_rules/keyword_list

- 读接口整体已失效（见第 1 条），`shield_rules`/`keyword_list` 语义无从实测。
- 现行官方屏蔽词是**房管接口**：`GetShieldKeywordList`（POST `{room_id}`）/ `AddShieldKeyword`（`{room_id, keyword}`）/ `DelShieldKeyword`，与个人本地屏蔽词（spec 007）无关；spec 007 决策 4「读取官方房间屏蔽词仅作参考展示」若重启需按房管接口重新评估权限。

### 风险控制（写操作的硬约束）

- **二次确认**：每个处置按钮弹 confirm，写明动作对象与后果；禁言单独标注「需房管权限」。
- **失败透明**：接口返回非 0 code 时原样展示 B 站的 message（如「无权限」），不静默。
- **不自动执行**：处置永远由人点击触发，检测引擎只标记、绝不联动自动处置（未来也不做）。
- **可逆优先**：拉黑/屏蔽发言提供对应的解除入口（面板内同位置切换为「解除」）。

### 实现位置（预估）

- `src/lib/action/`：`report.ts` / `block.ts` / `silence.ts`，统一封装 fetch + csrf + 错误透传。
- `panel.ts` 用户页 actions 区加按钮；按登录态与权限动态置灰（未登录/非房管时禁用并提示）。
- 接口侦察用 `tools/cdp-api-probe.ts` 在真实房间验证请求格式。

## 明确不做（out of scope）

- 自动处置（判定命中 → 自动拉黑/禁言）——永不。
- 批量处置。
- 房管后台的完整功能（看已禁言列表等），只做单用户快捷入口。

## 待决（OPEN）

1. **验收策略**：举报不可撤回、拿真实陌生用户测试拉黑/禁言有道德风险。候选：a) 只验证请求构造正确（CDP 拦截不真发）；b) 用户自备小号互测；c) 拉黑用「拉黑→解除」全链路实测（影响最小）。倾向 a+b 组合，请拍板。
2. ~~举报接口的类型枚举需要侦察~~ → 已解（2026-08-24 实测，见「接口实测」3a）：弹幕级举报 `dMReport/Report` 理由固定 7 项，UI 用固定下拉。**遗留实现风险**：提交表单的 `sign`（签名算法未反解）与 `id_str`（弹幕 dmid，DOM 不直接暴露）来源需立项验证。
3. ~~`shield_user` 权限语义~~ → 已定个人级（决策 3，2026-08-18）；2026-08-24 实测：写接口闭环成功、重连后效果确认，但官方读回接口已失效，面板状态需本地乐观维护。

## 验收标准

- 按待决 1 拍板的策略执行；接口错误路径有测试或 CDP 证据。
- typecheck / lint / `bun test test/` / build 全绿。
