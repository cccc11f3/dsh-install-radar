#!/usr/bin/env node
/**
 * 向 awesome-dsh-plugin 市场提 PR：只加一个文件 data/plugins/<owner>__<repo>.yml。
 * 规则来源：awesome-dsh-plugin/awesome-dsh-plugin 的 contributing.md
 *
 * 用法：
 *   $env:GITHUB_TOKEN='ghp_xxx'
 *   node publish/market-pr.mjs --user <owner> [--repo dsh-install-radar] [--dry]
 *
 * 不带 token 时自动进入 --dry 模式，只打印将要做的事与最终 YAML。
 */
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
const owner = args.get('user')
const repo = args.get('repo') || 'dsh-install-radar'
const dry = args.get('dry') === true || !token
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const BRANCH = `add-${repo}`

if (!owner) {
  console.error('缺少 --user <GitHub 用户名>')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entry = readFileSync(join(here, 'entry.yml'), 'utf8')
  .replaceAll('__OWNER__', owner)
  .replaceAll('__REPO__', repo)
  .replaceAll('__VERSION__', pkg.version)
const filePath = `data/plugins/${owner}__${repo}.yml`

console.log('=== 将提交的市场条目 ===')
console.log(entry)
console.log(`=== 目标文件：${filePath} ===`)

if (dry) {
  console.log('（dry 模式：没有 GITHUB_TOKEN，只打印计划）')
  console.log(`
计划：
  1. POST /repos/${UPSTREAM}/forks                     # fork 市场仓库到 ${owner}
  2. 等 fork 可用（轮询 GET /repos/${owner}/awesome-dsh-plugin）
  3. GET  /repos/${UPSTREAM}/git/ref/heads/main         # 取上游 main 的 sha
  4. POST /repos/${owner}/awesome-dsh-plugin/git/refs   # 在 fork 上建分支 ${BRANCH}
  5. PUT  /repos/${owner}/awesome-dsh-plugin/contents/${filePath}
  6. POST /repos/${UPSTREAM}/pulls                      # 开 PR（head=${owner}:${BRANCH}, base=main）
`)
  process.exit(0)
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

console.log('1) fork 市场仓库 …')
const fork = await api(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: JSON.stringify({ default_branch_only: true }) })
if (fork.ok || fork.status === 202) console.log('   已请求 fork')
else if (fork.status === 422) console.log('   fork 已存在')
else {
  console.error(`   fork 失败：HTTP ${fork.status} ${JSON.stringify(fork.body).slice(0, 300)}`)
  process.exit(1)
}

console.log('2) 等 fork 就绪 …')
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
  console.error('   fork 迟迟没就绪，稍后重跑本脚本即可（fork 会保留）')
  process.exit(1)
}

console.log('3) 取上游 main sha …')
const ref = await api(`/repos/${UPSTREAM}/git/ref/heads/main`)
if (!ref.ok) {
  console.error(`   取 ref 失败：HTTP ${ref.status}`)
  process.exit(1)
}
const sha = ref.body.object.sha

console.log(`4) 在 fork 上建分支 ${BRANCH} …`)
const branch = await api(`/repos/${owner}/awesome-dsh-plugin/git/refs`, {
  method: 'POST',
  body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha }),
})
if (!branch.ok && branch.status !== 422) {
  console.error(`   建分支失败：HTTP ${branch.status} ${JSON.stringify(branch.body).slice(0, 200)}`)
  process.exit(1)
}

console.log(`5) 写入 ${filePath} …`)
const put = await api(`/repos/${owner}/awesome-dsh-plugin/contents/${filePath}`, {
  method: 'PUT',
  body: JSON.stringify({
    message: `feat: add ${pkg.name}`,
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch: BRANCH,
  }),
})
if (!put.ok) {
  console.error(`   写入失败：HTTP ${put.status} ${JSON.stringify(put.body).slice(0, 300)}`)
  process.exit(1)
}

console.log('6) 开 PR …')
const pr = await api(`/repos/${UPSTREAM}/pulls`, {
  method: 'POST',
  body: JSON.stringify({
    title: `Add ${pkg.name}`,
    head: `${owner}:${BRANCH}`,
    base: 'main',
    body: readFileSync(join(here, 'PR.md'), 'utf8'),
  }),
})
if (pr.ok) {
  console.log(`   已开 PR：${pr.body.html_url}`)
} else if (pr.status === 422) {
  console.log('   PR 可能已存在：https://github.com/' + UPSTREAM + '/pulls')
} else {
  console.error(`   PR 失败：HTTP ${pr.status} ${JSON.stringify(pr.body).slice(0, 400)}`)
  process.exit(1)
}
