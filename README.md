# dsh-install-radar · 会话安装雷达

追踪「每个 DSH 会话到底往这台电脑里装了什么」，并给出**体积 / 安装位置 / 创建时间 / 用途 / 命令证据**。

三路证据互补——漏掉任何一路都会出现「明明少了 20G，插件却说没事」：

| 来源 | 能回答什么 | 边界 |
| --- | --- | --- |
| **会话日志归因**（`$DSH_HOME/sessions/**/session.v*.jsonl.zstd` 里的 `tool/call`） | 哪个会话、哪一轮、哪条命令装了 X，落在哪、多大、干什么用 | 只能看到命令痕迹；`$变量` 目标、远程脚本内部行为看不到 |
| **目录快照对比**（基线 vs 现在） | 已知监视根里凭空多出来的条目、明显变大的目录 | 需要先立基线；监视根以外的目录看不见 |
| **时间戳扫描**（`今天` 栏） | 「今天/近 N 天，哪个目录在吃盘」——包括临时目录、其它工具偷偷写的 | 只看时间窗口，不判断「该不该存在」 |

## v1.1.1 变更

- **卸载结果有回执**：点「一键卸载」后出一张结果条——成功是绿色 `✅ 卸载成功 · 释放 X`（+ 输出尾部），失败是红色 `❌ 卸载失败：winget 退出码 5`，下面跟 `🛠 解决办法` 列表（按工具给：程序还在运行 / 需要管理员 / 包 id 不对 / 指定解释器 / 路径被占用……）与「知道了」收起。
  - 特别处理「退出码 0 但其实没装」：`pip` 的 `Skipping … not installed`、`winget` 的 `No installed package found` 都会被判为失败并给出对应提示。
  - 目录型卸载失败（路径不存在 / 被占用 / 权限不足）同样给提示，不再静默。
- **所有行都能多选**：`非会话新增` 里每一行都有勾选框（含 🔴 danger、含 <50 MB 的小项）；单行的「清理」按钮仍保留门槛（≥50 MB 且非 danger），但**批量删除对所有勾选项开放**。
- **批量结果条**：删完显示 `✅ 删除 N 项 · 释放 X`；若其中有被拒（不在临时目录白名单、被占用等），变红并逐条列出 `路径 — 原因`，一眼知道哪些没删掉、为什么。


- **风险筛选**：`非会话新增` 顶部三个彩色按钮 `🟢 N / 🟡 N / 🔴 N`，点一下只看该档，再点取消；右侧显示 `当前显示 / 总数`。
- **一键卸载**：会话条目多了 `一键卸载` 按钮（两步确认，先显示将执行的命令）。按生态真正执行：`winget uninstall --id … --silent`、`python -m pip uninstall -y …`、`npm rm -g …`（项目内依赖 `npm rm …` 用项目 cwd）、`conda env remove -n … -y`；目录型（git clone / venv / 安装包）走删除。结果回显退出码与命令输出尾部，并写 `uninstall-log.jsonl`。
- **首次扫描进度**：面板在扫描期间每秒轮询 `/api/install-radar/progress`，显示阶段文字（扫描安装根目录 → 比对基线 → 读注册表 → 解析会话日志 → 解析条目 → 整理报告）与百分比进度条。
- **临时目录根可勾选**：`%LOCALAPPDATA%\Temp` 这类根行现在也能勾，语义是「清空里面的子项」——服务端会把根展开成它的一级子项逐个判定（仍受白名单、50 MB 门槛、danger 排除约束），不会整根删除。


- **条目分卡**：展开一个会话后，每条安装记录都是一张独立小卡（交替底色 + 左侧 3px 色条 + 8px 间距），相邻两行不再糊成一片。
- **「为什么装」**：每条记录多一行 `🎯 为什么装：…`。来源优先级：
  1. agent 自己给这条命令写的说明（`tool/call` 的 `description`）
  2. 它当轮推理/说明里最贴近的那一句（命中包名或「安装/依赖/SDK/clone」等关键词）
  3. 最后退回用户那句原话
  本机实测 8 条全部命中 agent 说明，例如「安装并验证腾讯云 ai3d SDK」「克隆 Hunyuan3D-2 仓库」「安装 Inno Setup 打包工具」。
- 工具输出（`install_radar_report` / `install_radar_sessions`）也在每条下面带 `为什么装: …`。


- **清理后不再重新拉取**：删完只把「真的删掉的行」从本地列表里摘掉——列表顺序、滚动位置、其它行的勾选状态全部原地保留。合计体积/文件数、`可清理 N / 总数`、两个全选按钮的数字都跟着本地扣减，不再触发一次全量重扫。
  - 通配行（`C:\Windows\Temp\cdp-*`）只要有一个子目录删成功就整行摘掉；删失败（被占用等）的行会留在原地，并保留它的勾选状态。
  - 单条清理与批量清理走同一套逻辑（`filterCleaned()`，纯函数，测试里直接断言）。
  - 需要真正的全量刷新时仍可按「重扫」。


- **选择栏吸附**：`可清理 N / 总数 · 全选 · 清空 · 删除选中 N · X GB` 这一条改成 `position: sticky`，吸附在列表滚动区顶部；滚到最下面勾完，直接点上面的按钮，不用再滚回顶部。按钮组靠右、计数靠左（`flex:1` 撑开），确认态在同一位置整条变红，不再单独出现在列表里。
- **两档全选**：`🟢 只选安全 9` 只勾 `risk === 'safe'` 的（cdp-*、HeadlessChrome*、pip-unpack-*、安装包…）；`🟢🟡 全选（含需注意） 12` 把 caution 也一起勾上（用户 Temp 下的普通目录之类）。两个按钮都带数量，一眼知道各自会勾多少。


- **定时自动清理（默认关）**：面板 `非会话新增` 顶部一行「定时自动清理 ⚪关 / 🟢开 + 超过 7 天 / 14 / 30 天」。开启后宿主每 90 秒采样时顺带执行：只清 **🟢 safe 且创建时间早于 N 天** 的临时垃圾（`cdp-*`、`HeadlessChrome*`、`pip-unpack-*`、安装包），仍然走同一套白名单与 `risk` 判定，每条都写 `clean-log.jsonl`（note=`auto(>Nd, safe)`）。设置存在 `$DSH_HOME/install-radar/config.json` 的 `autoClean` 里。
  - 只扫临时目录白名单的**一级子项**，不递归乱翻；被占用的删不掉就跳过，下一轮再试。
  - `install_radar_autoclean` 工具可以开关、改天数、`dryRun` 预览。
  - 自测：`node test/autoclean-check.mjs` —— 沙箱里造 60 MB / 1 KB / `.pnpm-store` 三个目录，验证「够大够老才删、小的不删、danger 不删」。
- **增长趋势**：`非会话新增` 顶部 14 天按天柱状图（按文件 `max(mtime, birthtime)` 分桶，鼠标悬停看当天体积与文件数），一眼看出哪几天堆得最快。走 `/api/install-radar/trend`，进程内缓存 5 分钟。
  - 本机实测：14 天合计 7.0 GB，峰值 2026-11-08 = 4.9 GB（就是 cdp-* 堆得最凶那天）。


- **批量删除（多选）**：`非会话新增` 每行前面多了勾选框（只有「可一键清理」的行能勾：≥50 MB 且不是 danger），顶部一条操作栏——`可清理 N / 总数`、`全选可清理`、`清空`、`删除选中 N 项 · X GB`。点删除先出确认条（🔴 确认删除以下 N 项，共 X GB？），第二下才真删；服务端一次最多处理 50 条，删完写 `clean-log.jsonl`。
- **三色警告**：所有后果标注改成 emoji 前置——🟢 不影响 / 🟡 需注意 / 🔴 不要删；不能一键删的行（风险高或 <50 MB）不显示勾选框，改用 🔴 标记。会话条目的「卸载后果」也带同样的三色。
- **复现线索的回退**：临时目录被清掉以后，`install_radar_repro` 不再空转——没有遗留目录时自动退回到「浏览器命令最多的那一轮会话」，并在界面标明是按哪种方式挑的（`pickedBy: history | commands`）。


- **复现线索**：`install_radar_repro` 从「历史侧写排名第一的那一轮」里把驱动脚本揪出来——收集会话里出现过的脚本名 + 会话命令里 `cd/Set-Location/New-Item` 提到的目录作为候选基，解析成绝对路径（解析不到的浅层按文件名找），读内容找 CDP 特征，再判断它**有没有清理临时 profile**；没有的给对应语言的清理钩子（Node / Python / PowerShell）。没有脚本文件、直接在命令里拉起浏览器的，单独给「内联驱动」结论。
  - 本机实测：714 条命令 → 6 个候选，第一候选 `E:\3D3\douyin-bridge.mjs`；漏得最狠的是 `E:\大肥鱼\tools\eval.mjs`（硬编码 `C:\Windows\Temp\cdp-eval-${PORT}`，无清理）与 `seq.mjs` / `poses.mjs`（各 142 / 17 次）。
- **两条页签上色**：`会话安装` 蓝、`非会话新增` 橙，未选中也有同色描边与圆点，选中态填色 + 光晕，不用猜现在在哪一栏。
- **会话条目也有卸载后果**：每个会话装的条目下面多一行「卸载后果」——`danger`（git 仓库删了整个目录没、node_modules 影响项目跑不起来）、`caution`（pip 包/全局命令，重装可恢复）、`safe`（安装包/下载文件）。


- **历史侧写（补过去）**：`install_radar_history` 把磁盘上遗留的 `cdp-*` 目录按**创建时间**，与会话日志里当时执行的 shell 命令对表（±20 分钟窗口）。命中浏览器特征（chrome / cdp / playwright / puppeteer / 截图 / 浏览器…）给「高概率」，只有普通命令给「中等」，窗口内没命令则判「非会话」。**只给概率与证据，不写死结论。**
  - 本机实测：303 个遗留目录 / 17.7 GB → 298 次对上一个会话，157 次高置信，证据是该会话在反复定位 `chrome.exe`。
- **清理门槛 50 MB**：小于 50 MB 的行不出现「清理」按钮，避免把正在用的临时文件删掉；`danger` 级（`.pnpm-store`、`Windows\Installer`、`site-packages`、浏览器 `User Data`…）一律不给一键删。
- **后果标注**：`非会话新增` 每行下面一行彩色结论——`不影响 / 需注意 / 不要删` + 具体后果（例：`无影响：浏览器自动化每次都会新建 profile，下次运行会重建`；`会破坏已装依赖：pnpm 的硬链接源，删了现有 node_modules 变断链`）。确认框里同样带这条。
- **采样器扩容 + 因果表**：不只认 CDP，还认临时 `--user-data-dir`、`pip install`、`npm/pnpm install`、模型下载、构建、ffmpeg。Chromium 的 GPU/渲染/crashpad 子进程被排除（否则全是噪音），`node/python` 脚本按进程名收紧。面板输出「发起者 → 类别 → 次数 → 关联路径」，并把路径与磁盘占用对账。


- **自动基线**：没有基线、或监视根变了（新增/删除目录）时，宿主自己重立，不用再点按钮。报告里带 `baselineAuto`（`first-run` / `roots-changed` / `null`）。
- **两类分开**：顶层只有两个页签——`会话安装`（蓝）与 `非会话新增`（橙）。
  - 会话安装下面三个子页签：按会话 / 按类型 / 按时间
  - 非会话新增里三块：时间戳扫描（1/3/7 天）、谁在拉起 CDP、基线以来新条目
- **颜色分层**：会话卡片交替底色 + 左侧蓝色条，展开后的条目再缩进一层、淡蓝底；非会话块一律橙色左边条，一眼分清「这是会话装的」还是「机器上长出来的」。
- **进程命令行审计**：`install_radar_procs` 抓 `Win32_Process` 完整命令行，命中 `--remote-debugging-port` / `--user-data-dir=*cdp-*` 的进程会被还原出父进程链；宿主每 90 秒自动采一次，落 `cdp-procs.jsonl`，面板按发起者聚合次数。
- **一键清理（二段式）**：`非会话新增` 每行有「清理」，第一下只弹确认行（显示路径与体积），第二下才真删；服务端还有一层白名单（只允许系统临时目录 / 用户临时目录 / `C:\Temp` / `TMP`），白名单外的路径直接拒绝，删完写 `clean-log.jsonl`。


- **新增「今天」栏**：按文件系统时间戳扫系统临时目录、用户临时目录、Local、Roaming、下载、桌面、C 盘根；同名数字后缀的兄弟目录自动合并（`C:\Windows\Temp\cdp-seq-9667…` → `cdp-seq*`），直接给出「17 GB 全是 cdp-*」这种结论。可切 1 / 3 / 7 天。
- **修掉漏检**：旧版只盯 `Program Files`、`%LOCALAPPDATA%\Programs` 等少数根，`C:\Windows\Temp`、`%LOCALAPPDATA%`、`C:\Windows\Installer`、`%ProgramData%`、用户主目录全都不在名单里——所以 17.7 GB 的临时目录堆了三天，报告一声不吭。现在这些根都进了默认监视列表。
- **面板默认全部折叠**，想看哪个点哪个。
- **一键打开文件夹**：每个条目除了「复制路径」还有「打开文件夹」（文件用 `explorer /select,` 选中，目录直接打开）。
- **会话消失审计**：`install_radar_audit` 给 `sessions/` 建索引并比对，消失的会话记进 `session-audit.jsonl`（谁、何时、消失前多大）。
- **用途兜底改成读签名**：知识库没收录时，去读目录里的 `package.json` / `*.dist-info/METADATA` / `README` / `.git/config`，把「这是什么」写在报告里；不是瞎猜，也不发网络请求。

## 安装

标准装法（需要一次重启）：

```powershell
dsh plugin --profile desktop add link:"E:\DeepSeek Harness工作区\dsh-install-radar"
```

本机实际装法是手工落地的：

1. `profiles/desktop/node_modules/dsh-install-radar` → 指向本目录的 **junction**
2. `profiles/desktop/package.json`：`dependencies["dsh-install-radar"] = "link:…"`，并把 `dsh-install-radar` 追加进 `dsh.profile.bundles`

回滚：删掉 junction、用 `package.json.bak-radar-*` 覆盖回去、重启。

### 顺手修掉的坑：`pnpm add` 不再 404

原来 profile 里 `dsh-purge` 指向的 GitHub 归档（`codeload.github.com/YuJunZhiXue/dsh-purge/tar.gz/refs/heads/master`）已经 404，任何 `pnpm add` 都会整树重解析失败，还可能把 `link:` 依赖冲掉。

修法（不动插件行为，只换来源）：把已装的 **dsh-purge 1.1.92** 原样收进 `profiles/desktop/vendor/dsh-purge`，依赖改成 `"dsh-purge": "file:vendor/dsh-purge"`，然后在隔离目录用捆绑 pnpm 跑 `install --lockfile-only` 验证（253 个包，`exit 0`），最后同步真实 profile 的锁文件。

npm 上的 `dsh-purge` 只有占位版 `0.0.0-stage`，不能顶替；市场里的同名分叉会改变行为，所以选择 vendoring。上游恢复后改回 `github:<owner>/dsh-purge` 再 `pnpm install` 即可。

彻底对齐（可选，建议关掉 DSH 再跑）：

```powershell
node "E:\新建文件夹 (2)\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install `
  --dir "E:\DeepSeek Harness\shuju\profiles\desktop"
```

## 侧栏面板

| 项 | 值 |
| --- | --- |
| 插槽 | `sidebar.panellist`（root 作用域 list，一行一个图标）+ `main`（root 作用域 keyed，key = `install-radar`） |
| 位置 | `order: -20`，排在官方面板行之前，也就是**工作区之上** |
| 图标 | 16/18px 盒子轮廓 + 中心点，跟主题同色（`currentColor`） |
| 数据 | 只走宿主路由 `/api/install-radar/{report,refresh,sessions,baseline,diff,recent,open}`（`ctx.connection.rpc.call`） |

四个视图：

- `按会话` —— 谁装的，默认全部折叠，点开才展开
- `按类型` —— Python 包 / Node 包 / 代码仓库 / winget 程序…按体积降序，带头部占比条
- `按时间` —— 按 `YYYY-MM` 分组
- `今天` —— 时间戳扫描结果，1 / 3 / 7 天可切；每行一个归属目录，附示例路径

每个条目行尾：`复制路径` / `打开文件夹` / `卸载命令`（只复制，不执行）。

## Agent 工具

- `install_radar_report` —— 完整报告，并写 `$DSH_HOME/install-radar/report.md`
- `install_radar_sessions` —— 只看会话命令证据，可按关键词过滤
- `install_radar_recent` —— 「今天/近 N 天谁在吃盘」，按归属目录聚合
- `install_radar_baseline` —— 立基线（装东西之前跑一次）
- `install_radar_diff` —— 基线以来新出现 / 明显变大的目录
- `install_radar_audit` —— 会话目录索引与消失审计

## 不进 DSH 也能跑（CLI）

```powershell
node bin/radar.mjs roots                     # 看会扫哪些根
node bin/radar.mjs baseline                  # 立基线
node bin/radar.mjs scan                      # 扫现状（最大的 15 项）
node bin/radar.mjs sessions                  # 历史会话装了啥
node bin/radar.mjs recent --days 3           # 近 3 天谁在吃盘
node bin/radar.mjs diff                      # 基线以来新增
node bin/radar.mjs report --out report.md    # 完整 Markdown 报告
```

通用参数：`--home <DSH_HOME>`、`--extra <目录>`（可重复）、`--limit <会话数>`、`--days <天数>`、`--json`。

## 自测

```powershell
node test/host-smoke.mjs     # 6 个工具 + 7 条路由 + report 路由真跑一遍（会扫盘）
node test/client-smoke.mjs   # 不开浏览器：加载 client bundle、断言两个插槽注册、构造元素树（含默认折叠）
```

## 认哪些安装方式

`pip / python -m pip / uv add`、`npm / pnpm / yarn / bun`、`git clone`、`winget`、`choco / scoop`、`cargo install`、`go install`、`docker pull`、`huggingface-cli download`、`python -m venv`、`conda create`、`Invoke-WebRequest/curl -OutFile`、`irm | iex` 远程脚本、静默安装器（`setup.exe /S`）。

## 落到路径的规则（逐级退化）

1. 生态约定路径：`site-packages/<包>`、`node_modules/<包>`、`WinGet\Packages/<id>*`、`chocolatey\lib/<包>`
2. 发行名 ≠ import 名时按前缀退化（`tencentcloud-sdk-python-ai3d` → `tencentcloud`）
3. 注册表 `Uninstall` 清单（DisplayName / InstallLocation / EstimatedSize）——GUI 程序与安装器靠这个
4. 命令里的 `cd` / `New-Item` 提示目录（`cd E:\3DAI; git clone …` → 落点按 E:\3DAI 算）
5. 快照里叶名严格同名
6. 都失败 → 明确标 `[未找到产物]`，不猜

## 体积怎么算

递归求和，跳过符号链接与 junction（Windows 上是 reparse point，会成环），单条目最多数 40 万个文件，超了标 `truncated`。

量过的大目录进 `$DSH_HOME/install-radar/size-cache.json`（30 分钟有效，目录 mtime 变了重算）；快照进程内缓存 10 分钟，面板数据再叠 45 秒缓存。

## 目录

```
src/engine/roots.js       监视根定义（含「今天」专用根）
src/engine/scan.js        递归体积、并发池
src/engine/recent.js      时间戳扫描 + 同名前缀合并
src/engine/sessions.js    zstd 逐帧解压 → 抽 tool/call
src/engine/commands.js    命令 → 安装事件（含 cd/New-Item 落点提示）
src/engine/resolve.js     安装事件 → 磁盘路径 + 体积
src/engine/registry.js    Windows 已安装程序清单
src/engine/audit.js       会话目录索引 / 消失审计
src/engine/signature.js   目录签名推断（package.json / METADATA / README）
src/engine/sizecache.js   体积缓存
src/engine/classify.js    用途知识库 + 体积格式化
src/engine/uninstall.js   卸载命令生成
src/engine/radar.js       编排、基线、diff、recent、Markdown
src/index.js              Cordis 宿主：6 个工具 + 7 条面板路由
src/client.js             浏览器半：侧栏图标 + 主面板（四栏 + 三个按钮）
bin/radar.mjs             CLI
tools/fix-profile-deps.cjs  把 dsh-purge 依赖改到 vendor 目录
test/                     两端冒烟测试
```

## 发布

`publish/` 里是发布用的脚本与市场条目模板，见 [publish/README.md](publish/README.md)：

```powershell
pwsh -File publish\npm-publish.ps1              # 发 npm（需先 npm login）
node publish\github-repo.mjs --user <你>        # 建 GitHub 仓库（需 GITHUB_TOKEN）
node publish\market-pr.mjs --user <你>          # 提市场 PR（只加一个 yml）
```

## 已知边界

- 会话日志是 zstd 多帧格式，必须逐帧解压；正在写入的尾帧可能解不开（跳过，不影响其余）。
- `git clone` 到 `$t` 这类临时变量、以及远程脚本内部再装的包，只能看到命令、看不到产物。
- conda 环境整体算一个体积单元，不拆到包级。
- 「今天」扫描默认只看交互用户能读到的目录，`C:\Windows\WinSxS`、回收站等被显式跳过。
- 基线扩容后第一次 `diff` 会把新纳入的根当成「新出现」，重新点一次「立基线」即可清干净。
