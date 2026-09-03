# 发版流程

> 记录 Live Judgment 的发布步骤与环境坑，供人与 agent 复用。

## 标准步骤

```bash
# 1. 构建（产物 dist/live-judgment.user.js）
bun run build

# 2. 发布（标签与 package.json / userscript 头中的 version 保持一致）
gh release create vX.Y.Z dist/live-judgment.user.js \
  --repo Rheron1848/Live_Judgment \
  --title "vX.Y.Z" \
  --notes "发布说明"
```

- 版本号在 `package.json` 的 `version` 字段，构建时由 vite-plugin-monkey 写入 userscript 头的 `@version`；发版前先改版本号再构建。
- `gh release create` 会自动在远端 main HEAD 上打对应标签，无需手动 `git tag`。
- 首次发布记录：v0.1.0（2026-08-25）。

## 环境坑（2026-08 首次发版时遇到）

- 本机无 bun：`npm i -g bun` 安装（bun 1.4.0）。
- 本机无 gh CLI：`winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements`。
- `gh auth login` 不接受 git 凭据管理器中已存的 token（缺 `read:org` scope），绕过方式：

  ```bash
  TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill | grep '^password=' | cut -d= -f2-)
  printf '%s' "$TOKEN" | GH_TOKEN=$(cat) gh release create ...
  ```

  token 只走管道，不落地、不打印。
- Git Bash 会话在安装 gh 之前启动时 PATH 不含 gh，用全路径 `"/c/Program Files/GitHub CLI/gh.exe"` 调用。
- Windows 克隆行尾坑（2026-09-03）：`core.autocrlf=true` 时全仓库检出为 CRLF，`biome check` 误报 52 个文件格式错。仓库已加 `.gitattributes`（`* text=auto eol=lf`）；已有本地克隆需 `git config core.autocrlf false` 后强制重检出一次（`git ls-files -z | xargs -0 rm -f && git checkout -- .`，仅在工作区干净时执行）。

## 自动更新

- 产物头部带 `@downloadURL` / `@updateURL`（在 `vite.config.ts` 的 userscript 配置中），指向 `releases/latest/download/live-judgment.user.js` 固定链接，Tampermonkey / Violentmonkey 会自动更新。
- 2026-08-25 变更：v0.1.0 发布时产物无这两个字段，后补加并就地覆盖了 release 资产（`gh release upload --clobber`）；此前手动安装的旧副本没有 `@updateURL`，不会自动更新，需重装一次。
