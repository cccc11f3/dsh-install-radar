# 发布手册（dsh-install-radar）

本目录里的脚本把发布拆成三步，**只有第 1 步需要你自己动手**（登录），其余全自动。

---

## 0. 现状（我已做完的部分）

- 包已按 npm 要求整理好：`LICENSE`、`README.md`（中）、`README.en.md`（英）、`files` 白名单
- `npm pack --dry-run`：28 个文件 / 79.6 kB（解压 249.7 kB），无多余文件
- `npm publish --dry-run`：通过，只缺登录
- 包名 `dsh-install-radar` 在 registry.npmjs.org 上**未被占用**
- 版本 `1.0.0`，`publishConfig: { registry: https://registry.npmjs.org, access: public }`

---

## 1. 登录（唯一手动步骤，二选一）

```powershell
# A. 交互登录（推荐，浏览器里点一下）
npm login --registry=https://registry.npmjs.org

# B. 用 token（适合脚本/CI）
$env:NPM_TOKEN = 'npm_xxxxxxxxxxxxxxxx'
```

> 你的 `~/.npmrc` 里现在写的是 `registry=https://registry.npmmirror.com`（国内镜像，只读）。
> 发布必须走官方源，脚本里已经显式加了 `--registry`，不用改全局配置。

## 2. 发到 npm（自动）

```powershell
cd "E:\DeepSeek Harness工作区\dsh-install-radar"
pwsh -File publish\npm-publish.ps1
```

脚本会：校验登录 → `npm publish --registry=https://registry.npmjs.org` → `npm view` 回查 → 打印安装命令。

## 3. 推 GitHub（市场收录必需）

市场条目要求 `url` 指向一个真实存在的 GitHub 仓库。两条路：

**A. 不交 token（推荐，30 秒）**

```powershell
# 1) 浏览器里建空仓库：https://github.com/new
#    仓库名 dsh-install-radar，不要勾 README / .gitignore / license
# 2) 推送（首次会弹 GitHub 登录窗口，登录一次即可）
pwsh -File publish\push-to-github.ps1 -Owner <你的GitHub用户名>
```

**B. 给我 token，全自动建库+推送**

```powershell
$env:GITHUB_TOKEN = 'ghp_xxxxxxxx'
node publish\github-repo.mjs --user <你的GitHub用户名> --name dsh-install-radar
```

> 本地仓库已经初始化并提交好了（43 个文件，`.git` 约 0.1 MB），
> 两条路都是「直接 push」，不需要再 commit。本地 git 身份设成了
> `YG <yg@users.noreply.github.com>`（仅本仓库，未改全局）。

### 本机实测：git 传输被墙，改用 GitHub API 推送

这台机器上 `api.github.com` 通，但 `github.com:443` 超时（`git push` 报
`Failed to connect to github.com port 443`）。所以实际用的是 API 推送：

```powershell
$env:GITHUB_TOKEN = 'ghp_xxx'
node publish\api-push.mjs --owner <owner> --repo dsh-install-radar --message "feat: …"
```

它用 `git ls-files` 取本地清单 → `POST /git/trees`（**content 是明文，不是 base64**，这一点踩过坑）
→ `POST /git/commits` → `PATCH /git/refs/heads/main`。空仓库会先用 Contents API 写一份 README 引导出 `main`。

⚠️ 含 API 推送之后，远端历史与本地 `.git` 是两条独立历史（本地 5 个 commit，远端由 API 生成）。
以后更新仓库请**继续用 `api-push.mjs`**，不要 `git push`（git 传输在这台机器上本来就通不了）。

## 4. 提市场 PR（自动）

市场收录规则：**只加一个文件** `data/plugins/<owner>__<repo>.yml`（见 `awesome-dsh-plugin/contributing.md`）。

```powershell
node publish\market-pr.mjs --user <你的GitHub用户名>
```

脚本会：fork `awesome-dsh-plugin/awesome-dsh-plugin` → 建分支 → 写入 YAML → 提交 PR，
并打印 PR 链接。YAML 模板在 `publish/entry.yml`，PR 正文在 `publish/PR.md`。

---

## 5. 发布后自检

```powershell
# 从 npm 装一遍（换台机器或新 profile 更真实）
dsh plugin --profile desktop add dsh-install-radar
```

- 侧栏「工作区」上方应出现图标
- 打开面板能看到两个页签、趋势柱、条目卡片
- `install_radar_report` 能返回本机会话安装清单

## 6. 版本迭代

```powershell
npm version patch|minor|major   # 只改 version 字段
npm publish --registry=https://registry.npmjs.org
```

市场条目不用改版本，市场每次读取 npm 的最新版本。
