#!/usr/bin/env node
/**
 * 用 GitHub API 推送整个仓库（不依赖 git push，绕开 github.com:443 被墙/超时的情况）。
 *
 * 用法：
 *   $env:GITHUB_TOKEN='ghp_...'
 *   node publish/api-push.mjs --owner <owner> [--repo dsh-install-radar] [--message "…"]
 *
 * 做法：git ls-files 拿清单 → 一次 POST /git/trees（内容内联 base64）→ POST /git/commits →
 *       PATCH /git/refs/heads/main。空仓库和有历史的仓库都能用（有历史时以现有 tree 为 base）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
const owner = args.get('owner')
const repo = String(args.get('repo') || 'dsh-install-radar')
const message = String(args.get('message') || 'feat: dsh-install-radar')

if (!token || !owner) {
  console.error('用法：GITHUB_TOKEN=… node publish/api-push.mjs --owner <owner> [--repo <repo>]')
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

// 1) 本地文件清单（走 git，天然遵守 .gitignore）
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
if (files.length === 0) {
  console.error('git ls-files 为空，先在本地 git add')
  process.exit(1)
}
console.log(`本地文件 ${files.length} 个`)

// 2) 现有 main 的 base tree
const readmePath = join(root, 'README.md')
const bootstrap = async () => {
  // 空仓库（没有 ref）时 Git Data API 会返回 409，先用 Contents API 建一个首提交
  const content = readFileSync(readmePath).toString('base64')
  const res = await api(`/repos/${owner}/${repo}/contents/README.md`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'chore: bootstrap repository', content, branch: 'main' }),
  })
  if (!res.ok) {
    console.error(`引导提交失败：HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`)
    process.exit(1)
  }
  console.log('空仓库：先写入 README 引导出 main 分支')
}

let refRes = await api(`/repos/${owner}/${repo}/git/ref/heads/main`)
if (!refRes.ok) {
  await bootstrap()
  refRes = await api(`/repos/${owner}/${repo}/git/ref/heads/main`)
}

let baseTree
let parents = []
if (refRes.ok) {
  const sha = refRes.body.object.sha
  const commit = await api(`/repos/${owner}/${repo}/git/commits/${sha}`)
  if (commit.ok) {
    baseTree = commit.body.tree.sha
    parents = [sha]
  }
  console.log(`已有 main（${sha.slice(0, 7)}），在它之上提交`)
} else {
  console.log('空仓库，创建首个提交')
}

// 3) 建 tree（注意：/git/trees 的 content 字段是**明文**，不是 base64；
//    只有 /contents 接口才用 base64。这里全部按 UTF-8 文本提交）
const tree = files.map((path) => ({
  path,
  mode: '100644',
  type: 'blob',
  content: readFileSync(join(root, path), 'utf8'),
}))
const treeRes = await api(`/repos/${owner}/${repo}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree }),
})
if (!treeRes.ok) {
  console.error(`建 tree 失败：HTTP ${treeRes.status} ${JSON.stringify(treeRes.body).slice(0, 300)}`)
  process.exit(1)
}
console.log(`tree: ${treeRes.body.sha.slice(0, 7)}`)

// 4) 建 commit
const commitRes = await api(`/repos/${owner}/${repo}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message, tree: treeRes.body.sha, parents }),
})
if (!commitRes.ok) {
  console.error(`建 commit 失败：HTTP ${commitRes.status} ${JSON.stringify(commitRes.body).slice(0, 300)}`)
  process.exit(1)
}
console.log(`commit: ${commitRes.body.sha.slice(0, 7)}`)

// 5) 更新 ref
const update = await api(`/repos/${owner}/${repo}/git/refs/heads/main`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commitRes.body.sha, force: true }),
})
if (update.ok) {
  console.log(`✅ main -> ${commitRes.body.sha.slice(0, 7)}`)
} else {
  const create = await api(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'refs/heads/main', sha: commitRes.body.sha }),
  })
  if (!create.ok) {
    console.error(`更新 ref 失败：HTTP ${update.status} / ${create.status}`)
    process.exit(1)
  }
  console.log(`✅ 创建 main -> ${commitRes.body.sha.slice(0, 7)}`)
}

// 6) 设默认分支为 main（空仓库建的首个 ref 有时不是默认分支）
await api(`/repos/${owner}/${repo}`, { method: 'PATCH', body: JSON.stringify({ default_branch: 'main' }) })

const check = await api(`/repos/${owner}/${repo}/contents/package.json`)
console.log(check.ok ? '✅ 校验：远端已有 package.json' : `⚠️ 校验失败：HTTP ${check.status}`)
console.log(`仓库：https://github.com/${owner}/${repo}`)
