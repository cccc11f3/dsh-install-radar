/**
 * 复现线索：从「最可能出事的那一轮会话」里，把真正在跑浏览器自动化的脚本揪出来。
 *
 * 全部离线只读：
 *   1. 取该会话所有 shell 命令，收集「候选目录」（会话 cwd + 命令里 cd/Set-Location/New-Item 的绝对路径）
 *   2. 抽命令里出现的脚本文件名（.js/.mjs/.cjs/.ts/.py/.ps1/.bat/.cmd），按候选目录解析成绝对路径
 *   3. 解析不出来的，在候选目录里浅层（≤3 层）按文件名找
 *   4. 读文件内容，看有没有 CDP 特征（user-data-dir / remote-debugging / cdp- / chrome.exe）
 *   5. 判断它自己有没有清理临时 profile，没有的给一段可直接粘贴的清理钩子
 *   6. 连脚本文件都没有的（命令里直接拉起 Chrome），单独给一个「内联驱动」结论与钩子
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { collectCommands } from './sessions.js'

const SCRIPT_EXT = /\.(js|mjs|cjs|ts|py|ps1|bat|cmd)$/i
const CDP_HINT = /--remote-debugging-port|--user-data-dir|cdp-|chrome\.exe|chromium|playwright|puppeteer/i
const CLEANUP_HINT = /rmSync|rm\s+-rf|Remove-Item|fs\.rm\b|unlink|rmdir|finally\s*\{|process\.on\(['"]exit|trap\s|cleanup|dispose/i
const MAX_SCAN_FILES = 600

/** 命令里出现的目录：cd / Set-Location / New-Item / Test-Path */
function dirsIn(command) {
  const out = []
  const patterns = [
    /(?:Set-Location|cd|Push-Location)\s+['"]?([A-Za-z]:[^\s'";|]+)/gi,
    /New-Item\s+-ItemType\s+Directory[^;|]*?['"]([A-Za-z]:[^'"]+)['"]/gi,
    /Test-Path\s+['"]([A-Za-z]:[^'"]+)['"]/gi,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(command)) !== null) out.push(match[1].replace(/[\\/]+$/, ''))
  }
  return out
}

async function readText(file, maxBytes = 512 * 1024) {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > maxBytes) return ''
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** 在 base 下浅层按文件名找 */
async function shallowFind(base, name, depth = 3) {
  if (depth < 0) return ''
  let list
  try {
    list = await readdir(base, { withFileTypes: true })
  } catch {
    return ''
  }
  for (const entry of list) {
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return join(base, entry.name)
  }
  for (const entry of list) {
    if (!entry.isDirectory()) continue
    if (/^(node_modules|\.git|dist|build|\.venv|venv|__pycache__)$/i.test(entry.name)) continue
    const hit = await shallowFind(join(base, entry.name), name, depth - 1)
    if (hit) return hit
  }
  return ''
}

/** 在 base 下浅层收集脚本文件（拿不到文件名线索时兜底） */
async function shallowScripts(base, depth = 2, acc = []) {
  if (depth < 0 || acc.length > MAX_SCAN_FILES) return acc
  let list
  try {
    list = await readdir(base, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of list) {
    if (acc.length > MAX_SCAN_FILES) break
    if (entry.isFile() && SCRIPT_EXT.test(entry.name)) acc.push(join(base, entry.name))
    else if (entry.isDirectory() && !/^(node_modules|\.git|dist|build|\.venv|venv|__pycache__)$/i.test(entry.name)) {
      await shallowScripts(join(base, entry.name), depth - 1, acc)
    }
  }
  return acc
}

/**
 * @param {{home:string, sessionId:string, limit?:number}} opts
 */
export async function findReproClues({ home, sessionId, limit = 6 }) {
  const commands = await collectCommands(home)
  const mine = commands.filter((command) => command.sessionId === sessionId)
  if (mine.length === 0) return { sessionId, commands: 0, candidates: [], inline: null, note: '该会话没有可读 shell 命令' }

  const bases = []
  const pushBase = (value) => {
    if (!value || !isAbsolute(value)) return
    const real = resolve(value)
    if (!bases.some((base) => base.toLowerCase() === real.toLowerCase())) bases.push(real)
  }
  for (const command of mine) {
    pushBase(command.cwd)
    for (const dir of dirsIn(command.command)) pushBase(dir)
  }

  // 1) 命令里出现过的脚本名 → 在候选目录里解析
  const names = new Map()
  for (const command of mine) {
    const matches = command.command.match(/[^\s"'`()|;]+\.(?:js|mjs|cjs|ts|py|ps1|bat|cmd)\b/gi) || []
    for (const raw of matches) {
      const clean = raw.replace(/^[\\/]+/, '')
      const name = basename(clean)
      if (!name || /^(node|nodejs|npm|pnpm|yarn)$/i.test(name)) continue
      const bucket = names.get(name.toLowerCase()) || { name, paths: new Set(), uses: 0, sample: '' }
      bucket.uses++
      if (!bucket.sample) bucket.sample = command.command.split('\n')[0].slice(0, 160)
      if (isAbsolute(raw)) bucket.paths.add(resolve(raw))
      names.set(name.toLowerCase(), bucket)
    }
  }

  const resolved = new Map()
  for (const bucket of names.values()) {
    const tried = []
    for (const base of bases) {
      const candidate = join(base, bucket.name)
      tried.push(candidate)
      if (await exists(candidate)) {
        resolved.set(candidate.toLowerCase(), { path: candidate, uses: bucket.uses, sample: bucket.sample })
        break
      }
    }
    if ([...resolved.values()].some((item) => basename(item.path).toLowerCase() === bucket.name.toLowerCase())) continue
    for (const base of bases) {
      const hit = await shallowFind(base, bucket.name)
      if (hit) {
        resolved.set(hit.toLowerCase(), { path: hit, uses: bucket.uses, sample: bucket.sample })
        break
      }
    }
  }

  // 2) 兜底：从候选目录里浅扫脚本，内容里有 CDP 特征的才算
  if (resolved.size === 0) {
    for (const base of bases) {
      for (const file of await shallowScripts(base)) {
        const body = await readText(file)
        if (body && CDP_HINT.test(body)) resolved.set(file.toLowerCase(), { path: file, uses: 0, sample: '(未在命令里直接点名，按内容命中)' })
        if (resolved.size >= 12) break
      }
    }
  }

  const candidates = []
  for (const item of resolved.values()) {
    const body = await readText(item.path)
    if (!body) continue
    const cdpLines = body
      .split('\n')
      .filter((line) => CDP_HINT.test(line))
      .map((line) => line.trim().slice(0, 170))
    if (cdpLines.length === 0) continue
    let info
    try {
      info = await stat(item.path)
    } catch {
      info = null
    }
    const cleansUp = CLEANUP_HINT.test(body)
    const chromeBaked = /chrome\.exe|chromium|msedge/i.test(body)
    candidates.push({
      path: item.path,
      bytes: info?.size ?? 0,
      mtimeMs: info?.mtimeMs ?? null,
      usedInCommands: item.uses,
      sample: item.sample,
      cdpLines: cdpLines.slice(0, 4),
      buildsProfileDir: /mkdtemp|userDataDir|user-data-dir|tmpdir|os\.tmpdir|tempfile|guid/i.test(body),
      chromeBaked,
      cleansUp,
      verdict: cleansUp
        ? '脚本里有清理逻辑（cleanup/finally/rm/exit 钩子），临时 profile 应该在退出时被删'
        : '脚本里没有清理逻辑 —— 临时 profile 只进不出，这就是堆积来源',
      hook: cleansUp ? '' : buildHook(item.path, body),
    })
  }
  candidates.sort((a, b) => b.cdpLines.length - a.cdpLines.length || b.usedInCommands - a.usedInCommands)

  // 3) 完全没有脚本文件：命令里直接拉起浏览器
  const inlineCommand = mine.find((command) => /chrome\.exe|msedge\.exe/i.test(command.command) && /user-data-dir|remote-debugging|--headless/i.test(command.command))
  const inline = inlineCommand && candidates.length === 0
    ? {
        sample: inlineCommand.command.split('\n').slice(0, 3).join('\n').slice(0, 600),
        time: inlineCommand.time,
        verdict: '这一轮是命令里直接拉起 Chrome（没有独立脚本文件），所以没有文件可改——只能在命令层面加 finally 清理',
        hook: buildHook('inline.ps1', ''),
      }
    : null

  return {
    sessionId,
    cwd: mine.find((command) => command.cwd)?.cwd || '',
    bases: bases.slice(0, 6),
    commands: mine.length,
    candidates: candidates.slice(0, limit),
    inline,
    note: candidates.length === 0 && !inline ? '没找到带 CDP 特征的脚本，也没找到内联的浏览器命令' : '',
  }
}

/** 按脚本语言给「退出时删掉临时 profile」的钩子建议（只是建议，不写文件） */
function buildHook(file, body) {
  const isNode = /\.(js|mjs|cjs|ts)$/i.test(file)
  const isPython = /\.py$/i.test(file)
  if (isNode) {
    const usesPuppeteer = /puppeteer|playwright/i.test(body)
    return `// 在拉起浏览器的地方建目录，退出时删掉
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const profileDir = path.join(os.tmpdir(), \`cdp-agent-\${Date.now()}\`)
fs.mkdirSync(profileDir, { recursive: true })
const cleanup = () => { try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('uncaughtException', (err) => { cleanup(); throw err })

// 启动参数里把 --user-data-dir 换成 profileDir${usesPuppeteer ? '\n// puppeteer/playwright: 直接传 userDataDir: profileDir' : ''}`
  }
  if (isPython) {
    return `import atexit, shutil, tempfile

profile_dir = tempfile.mkdtemp(prefix="cdp-agent-")
atexit.register(lambda: shutil.rmtree(profile_dir, ignore_errors=True))
# subprocess 参数里用 f"--user-data-dir={profile_dir}"`
  }
  return `$profile = Join-Path $env:TEMP ("cdp-agent-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $profile | Out-Null
try {
    # 原来的启动命令，参数里加 "--user-data-dir=$profile"
} finally {
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}`
}

export { CDP_HINT as REPRO_CDP_HINT }
