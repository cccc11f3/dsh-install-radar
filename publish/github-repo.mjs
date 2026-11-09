#!/usr/bin/env node
/**
 * 在 GitHub 上建仓库并推送当前目录（市场收录要求 url 指向真实仓库）。
 *
 * 用法：
 *   $env:GITHUB_TOKEN='ghp_xxx'
 *   node publish/github-repo.mjs --user <GitHub 用户名> [--name dsh-install-radar] [--private]
 *
 * 需要：git 在 PATH 上；token 具备 repo 权限。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
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
const user = args.get('user')
const name = args.get('name') || 'dsh-install-radar'
const isPrivate = args.get('private') === true

if (!user) {
  console.error('缺少 --user <GitHub 用户名>')
  process.exit(1)
}
if (!token) {
  console.error('缺少 GITHUB_TOKEN 环境变量（需要 repo 权限）')
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

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

console.log(`1) 确认账号 …`)
const me = await api('/user')
if (!me.ok) {
  console.error(`   token 无效：HTTP ${me.status} ${JSON.stringify(me.body).slice(0, 200)}`)
  process.exit(1)
}
console.log(`   ${me.body.login}`)

console.log(`2) 创建仓库 ${user}/${name} …`)
const created = await api('/user/repos', {
  method: 'POST',
  body: JSON.stringify({
    name,
    description: pkg.description,
    private: isPrivate,
    has_issues: true,
    has_wiki: false,
    license_template: 'mit',
  }),
})
if (created.ok) console.log(`   已创建：${created.body.html_url}`)
else if (created.status === 422) console.log('   仓库已存在，跳过创建')
else {
  console.error(`   创建失败：HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`)
  process.exit(1)
}

console.log('3) git init / commit / push …')
const git = (argv, allowFail = false) => {
  try {
    return execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFail) return ''
    console.error(`   git ${argv.join(' ')} 失败：${error.stderr || error.message}`)
    process.exit(1)
  }
}

if (!existsSync(join(root, '.git'))) git(['init', '-b', 'main'])
git(['add', '-A'])
const staged = git(['diff', '--cached', '--name-only'])
if (staged) git(['-c', 'user.name=' + (me.body.name || me.body.login), '-c', 'user.email=' + (me.body.email || `${me.body.login}@users.noreply.github.com`), 'commit', '-m', `feat: dsh-install-radar v${pkg.version}`])
else console.log('   没有需要提交的改动')

const remoteUrl = `https://x-access-token:${token}@github.com/${user}/${name}.git`
git(['remote', 'remove', 'origin'], true)
git(['remote', 'add', 'origin', remoteUrl])
git(['push', '-u', 'origin', 'HEAD:main', '--force'])

console.log('')
console.log(`完成：https://github.com/${user}/${name}`)
console.log(`再跑：node publish/market-pr.mjs --user ${user} --repo ${name}`)
