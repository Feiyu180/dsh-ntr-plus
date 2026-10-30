# 安装 / Install

本发行包是 **dsh-ntr-plus 0.1.6** 的**已构建**版本：`lib/` 里就是可以直接运行的产物，**不需要** `npm install` 或 `npm run build`。
This release ships the **prebuilt** `lib/`, so no `npm install` / `npm run build` is needed.

前置条件 / Requirements：

- DeepSeek Harness（网页版 `dsh web` / TUI / 桌面 App 均可），插件 API 版本与 DSH 0.2.x 对齐
- 至少一个 ACP agent 的命令行程序（CodeBuddy、Claude Code、Pi、OpenCode、Qoder…… 任一支持 stdio 的 ACP agent）
- 安装时的 Node.js ≥ 22.12.0（`dsh plugin` 内部用 pnpm；运行时用的是 DSH 自带的 Node）

---

## 适用 DSH 版本

面向 **DSH 0.1.5-rc ~ 0.2.x** 的插件 API；0.3.x 改过权限与模型目录机制，**不保证兼容**。装完自检：设置 → NTR 能看到 agent 列表（宿主端已加载）；输入框行尾模型名里有 `ACP` 分组（模型目录生效）。

---

## 一、从本地包安装（推荐）/ From the local package

先看本机 profile 叫什么：网页版通常是 `web`，桌面 App 通常是 `desktop`，TUI 是 `tui`。

```bash
# 用本目录里的 tgz（路径换成你解压后的真实路径）
dsh plugin --profile web add ./dsh-ntr-plus-0.1.6.tgz
```

或者用解压出来的目录（会以 `link:` 方式装进去，改源码后重启即生效）：

```bash
dsh plugin --profile web add /绝对路径/dsh-ntr-plus
```

装完**重启 DSH**。插件带的 `dsh.bundle.patch` 会自动并进 profile 的 `bundles`，不需要手动改配置。

> `--profile` 必填，写错会装到另一个 profile 里（表现是装完看不到）。

---

## 二、从 GitHub 安装 / From GitHub

仓库推到 GitHub 之后，别人可以直接：

```bash
dsh plugin --profile web add github:<你的用户名>/dsh-ntr-plus
```

`pnpm` 会拉取仓库默认分支并安装；仓库里已经带了 `lib/`，所以同样不需要构建。
升级：改 `package.json` 版本号后重跑同一条命令，或 `dsh plugin --profile web update dsh-ntr-plus`。

---

## 三、装完怎么确认 / Verify

1. **设置 → NTR**：能看到 agent 列表和「测试」按钮，说明宿主端插件起来了。
2. **输入框行尾的模型名**：点开应能看到 `ACP` 分组（CodeBuddy / Pi / Claude Code……），说明原生模型目录对接生效。
3. **NTR 模式**：新建对话时模式选择器里出现「NTR 模式」（由 `presets/acp/acp.patch.yml` 声明，随包自动生效）。

第一次用某个 agent 之前，在 **设置 → NTR** 点「测试」：握手成功会显示 agent 名字和耗时；失败会显示可操作错误和 stderr 尾部。

---

## 四、常见问题 / Troubleshooting

**装完没反应 / 看不到 NTR**：十有八九是 `--profile` 写错，或者没重启 DSH（宿主端代码只在启动时加载一次）。

**`EPERM ... zod` 之类**：profile 里残留了旧版插件目录（pnpm 的 hoisted 布局会把 `link:` 目标里的 `node_modules` 留在包内）。先卸旧版、删掉 profile 里的 `node_modules/dsh-ntr-plus`，再重装。

**agent 工具全“空输出”**：会话的权限预设是「完全访问」时，插件会让 agent 自己的工具直接跑；如果你把它改回受限模式并配 `never` 审批策略，agent 的权限请求会被策略拒绝——插件会在聊天里给出提示。

**从源码改**：本包不含构建配置（`tsconfig.json` / `tests/`），要改源码请回到上游仓库按 README 的「从源码安装」流程走。
