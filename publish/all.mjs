#!/usr/bin/env node
/**
 * 一键发布：建仓库 → 填地址 → 提交 → 推送 → 加 topic → 向市场提 PR。
 *
 * 用法（只需要一个 GitHub token）：
 *   $env:GITHUB_TOKEN = 'ghp_...'          # classic PAT，勾 repo 即可
 *   node publish/all.mjs --owner <你的GitHub用户名> [--repo dsh-install-radar] [--private]
 *
 * token 权限：classic PAT 的 `repo`（建库+推送+PR 全覆盖）。
 * 中途失败可以直接重跑：每一步都会先探测「是否已完成」。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  const value = process.argv[i + 1]
  args.set(key.slice(2), value && !value.startsWith('--') ? value : true)
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const ownerArg = args.get('owner')
const repo = String(args.get('repo') || 'dsh-install-radar')
const isPrivate = args.get('private') === true
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'

if (!token) {
  console.error('缺少 GITHUB_TOKEN。生成：https://github.com/settings/tokens/new?scopes=repo&description=dsh-install-radar')
  process.exit(1)
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dsh-install-radar-publish',
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: response.ok, status: response.status, body }
}

const git = (argv, allowFail = false) => {
  try {
    return execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFail) return ''
    console.error(`git ${argv.join(' ')} 失败：${String(error.stderr || error.message).slice(0, 400)}`)
    process.exit(1)
  }
}

// 0) 我是谁
const me = await api('/user')
if (!me.ok) {
  console.error(`token 无效：HTTP ${me.status}`)
  process.exit(1)
}
const owner = ownerArg || me.body.login
if (owner.toLowerCase() !== String(me.body.login).toLowerCase()) {
  console.error(`--owner (${owner}) 与 token 所属账号 (${me.body.login}) 不一致；建库只能建在自己账号下`)
  process.exit(1)
}
console.log(`账号：${me.body.login}`)

// 1) 建仓库（已存在则跳过）
console.log(`1/6 创建仓库 ${owner}/${repo} …`)
const created = await api('/user/repos', {
  method: 'POST',
  body: JSON.stringify({ name: repo, description: 'Session install radar for DeepSeek Harness', private: isPrivate, has_issues: true, has_wiki: false }),
})
if (created.ok) console.log(`   已创建 ${created.body.html_url}`)
else if (created.status === 422) console.log('   已存在，跳过')
else {
  console.error(`   失败：HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`)
  process.exit(1)
}
const repoUrl = `https://github.com/${owner}/${repo}`

// 2) 地址写进 package.json + entry.yml
console.log('2/6 写入 repository / market entry …')
execFileSync(process.execPath, [join(here, 'set-repo.mjs'), '--url', repoUrl], { cwd: root, stdio: 'inherit' })

// 3) 提交 + 推送
console.log('3/6 提交并推送 …')
if (!existsSync(join(root, '.git'))) git(['init', '-b', 'main'])
git(['config', 'user.name', owner])
git(['config', 'user.email', `${owner}@users.noreply.github.com`])
git(['add', '-A'])
const staged = git(['diff', '--cached', '--name-only'])
if (staged) git(['commit', '-m', `chore: point repository at ${repoUrl}`])
git(['remote', 'remove', 'origin'], true)
git(['remote', 'add', 'origin', `https://x-access-token:${token}@github.com/${owner}/${repo}.git`])
git(['push', '-u', 'origin', 'HEAD:main', '--force'])
console.log(`   推送完成：${repoUrl}`)

// 4) topics（市场要求 dsh-plugin）
console.log('4/6 加 topics …')
const topics = await api(`/repos/${owner}/${repo}/topics`, {
  method: 'PUT',
  body: JSON.stringify({ names: ['dsh-plugin', 'deepseek-harness', 'dsh'] }),
})
console.log(topics.ok ? '   已加 dsh-plugin / deepseek-harness / dsh' : `   失败 HTTP ${topics.status}（可手动加）`)

// 5) fork 市场仓库
console.log(`5/6 fork ${UPSTREAM} …`)
const fork = await api(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: JSON.stringify({ default_branch_only: true }) })
if (!fork.ok && fork.status !== 422) console.log(`   fork 返回 HTTP ${fork.status}（可能已存在，继续）`)
let ready = false
for (let i = 0; i < 30; i++) {
  const check = await api(`/repos/${owner}/awesome-dsh-plugin`)
  if (check.ok) {
    ready = true
    break
  }
  await new Promise((done) => setTimeout(done, 2000))
}
if (!ready) {
  console.error('   fork 还没就绪，稍后单独跑 publish/market-pr.mjs 即可')
  process.exit(1)
}

// 6) 分支 + 条目 + PR
console.log('6/6 提交市场 PR …')
const branch = `add-${repo}`
const ref = await api(`/repos/${UPSTREAM}/git/ref/heads/main`)
const sha = ref.body.object.sha
await api(`/repos/${owner}/awesome-dsh-plugin/git/refs`, {
  method: 'POST',
  body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
})
const entry = readFileSync(join(here, 'entry.yml'), 'utf8')
const filePath = `data/plugins/${owner}__${repo}.yml`
const put = await api(`/repos/${owner}/awesome-dsh-plugin/contents/${filePath}`, {
  method: 'PUT',
  body: JSON.stringify({ message: `feat: add ${repo}`, content: Buffer.from(entry, 'utf8').toString('base64'), branch }),
})
if (!put.ok) {
  console.error(`   写文件失败：HTTP ${put.status} ${JSON.stringify(put.body).slice(0, 300)}`)
  process.exit(1)
}
const pr = await api(`/repos/${UPSTREAM}/pulls`, {
  method: 'POST',
  body: JSON.stringify({ title: `Add ${repo}`, head: `${owner}:${branch}`, base: 'main', body: readFileSync(join(here, 'PR.md'), 'utf8') }),
})
if (pr.ok) console.log(`   PR：${pr.body.html_url}`)
else if (pr.status === 422) console.log(`   PR 可能已存在：${repoUrl.replace(repo, '')}awesome-dsh-plugin/awesome-dsh-plugin/pulls`.replace('//', '/'))
else console.log(`   PR 失败：HTTP ${pr.status} ${JSON.stringify(pr.body).slice(0, 300)}`)

console.log('')
console.log(`仓库：${repoUrl}`)
console.log(`安装：dsh plugin --profile desktop add github:${owner}/${repo}`)
console.log('npm 需要单独登录后再跑：pwsh -File publish/npm-publish.ps1')
