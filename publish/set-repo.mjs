#!/usr/bin/env node
/**
 * 把 GitHub 仓库地址写进各处，保证三处一致：
 *   1. package.json → repository（npm 与仓库的关联靠它，市场会据此把包挂到仓库上）
 *   2. publish/entry.yml → url / name（市场条目必须与仓库完全一致）
 *   3. 打印市场 PR 需要的目标文件名 data/plugins/<owner>__<repo>.yml
 *
 * 用法：
 *   node publish/set-repo.mjs --url https://github.com/<owner>/<repo>
 *   node publish/set-repo.mjs --url https://github.com/<owner>/<repo> --topic   # 顺手加 dsh-plugin topic（需 GITHUB_TOKEN）
 */
import { readFileSync, writeFileSync } from 'node:fs'
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

const rawUrl = String(args.get('url') || '').trim().replace(/\.git$/, '').replace(/\/+$/, '')
const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(rawUrl)
if (!match) {
  console.error('需要一个形如 https://github.com/<owner>/<repo> 的地址（不带 .git、不带子目录）')
  process.exit(1)
}
const [, owner, repo] = match
const url = `https://github.com/${owner}/${repo}`

// 1) package.json → repository
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.repository = { type: 'git', url: `git+${url}.git` }
pkg.homepage = url
pkg.bugs = { url: `${url}/issues` }
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

// 2) publish/entry.yml
const entryPath = join(here, 'entry.yml')
const entry = readFileSync(entryPath, 'utf8')
  .replace(/^url: .*$/m, `url: ${url}`)
  .replace(/^name: .*$/m, `name: ${owner}/${repo}`)
writeFileSync(entryPath, entry, 'utf8')

// 3) 一致性检查
const checks = []
checks.push(['package.json repository', pkg.repository.url === `git+${url}.git`])
checks.push(['entry.yml url', entry.includes(`url: ${url}`)])
const dsh = pkg.dsh || {}
checks.push(['dsh.bundle.patch 存在', Boolean(dsh.bundle && dsh.bundle.patch)])
checks.push(['cordis.patch.yml 存在', readFileSync(join(root, 'cordis.patch.yml'), 'utf8').includes('insert:')])

console.log(`仓库：${url}`)
console.log(`市场条目文件：data/plugins/${owner}__${repo}.yml`)
console.log('')
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`)
if (checks.some(([, ok]) => !ok)) process.exit(1)

// 4) 可选：给仓库加 dsh-plugin topic（市场要求）
if (args.get('topic')) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    console.error('加 topic 需要 GITHUB_TOKEN')
    process.exit(1)
  }
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dsh-install-radar-publish',
    },
    body: JSON.stringify({ names: ['dsh-plugin', 'deepseek-harness', 'dsh'] }),
  })
  console.log(response.ok ? '✅ 已加 topics: dsh-plugin, deepseek-harness, dsh' : `❌ 加 topic 失败 HTTP ${response.status}`)
}

console.log('')
console.log('下一步：node publish/market-pr.mjs --user ' + owner + ' --repo ' + repo)
