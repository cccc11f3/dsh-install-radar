/**
 * 进程审计：不止盯 CDP，凡是「会持续往磁盘里堆东西」的命令行都记一笔。
 *
 * 抓 Win32_Process 的完整 CommandLine 与 ParentProcessId，按类别归类：
 *   cdp / browser-profile / npm / pip / model / node-script / python-script / build / ffmpeg
 * 然后把「发起者（父进程）→ 类别 → 次数 → 关联路径」聚成一张因果表，
 * 面板再拿这张表去和磁盘占用对账。
 */
import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 类别 → 命令行特征 */
const PATTERNS = [
  { key: 'cdp', re: /--remote-debugging-(port|pipe)/i, label: 'CDP 调试端口' },
  { key: 'browser-profile', re: /--user-data-dir=(?:"[^"]*(?:temp|cdp-|chrome-profile)[^"]*"|\S*(?:temp|cdp-|chrome-profile)\S*)/i, label: '临时浏览器 profile' },
  { key: 'model', re: /huggingface-cli\s+download|hf_hub_download|\.safetensors|ollama\s+(pull|run)|--model[-_]dir/i, label: '模型下载' },
  { key: 'pip', re: /\b(pip3?|uv)\s+install\b/i, label: 'pip 安装' },
  { key: 'npm', re: /\b(npm|pnpm|yarn|bun)\s+(install|i|add|exec|dlx|create)\b/i, label: 'Node 包安装' },
  { key: 'build', re: /electron-builder|vite\s+build|webpack|tsdown|esbuild/i, label: '前端/打包构建' },
  { key: 'ffmpeg', re: /\bffmpeg\b/i, label: '音视频转码' },
  { key: 'node-script', re: /^\s*"?[^"]*[\\/]?node(\.exe)?"?\s+.*\.(js|mjs|cjs)\b/i, label: 'Node 脚本', nameGate: /^node(\.exe)?$/i },
  { key: 'python-script', re: /^\s*"?[^"]*python[0-9.]*(\.exe)?"?\s+.*\.py\b/i, label: 'Python 脚本', nameGate: /^python[0-9.]*(\.exe)?$/i },
]

/** Chromium 的多进程子角色：GPU/渲染/crashpad 都不算「启动者」 */
const CHROMIUM_CHILD = /--type=(?!browser\b)[\w-]+/i

const SCRIPT = `$ErrorActionPreference='SilentlyContinue';
Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,CreationDate |
  Where-Object { $_.CommandLine } |
  Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate |
  ConvertTo-Json -Compress -Depth 3`

function runPowerShell(script, timeout = 30000) {
  return new Promise((done) => {
    if (process.platform !== 'win32') return done(null)
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => done(error ? null : String(stdout).trim()),
    )
  })
}

const parseDate = (value) => {
  if (typeof value === 'number') return value
  const text = String(value || '')
  const m = text.match(/\/Date\((\d+)/)
  return m ? Number(m[1]) : null
}

/** 抓一次进程表 */
export async function snapshotProcesses() {
  const text = await runPowerShell(SCRIPT)
  if (!text) return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map((item) => ({
    pid: item.ProcessId,
    ppid: item.ParentProcessId,
    name: item.Name || '',
    command: item.CommandLine || '',
    startedAt: parseDate(item.CreationDate),
  }))
}

/** 从命令行里抽它们可能写盘的目录 */
function pathsOf(command) {
  const paths = []
  for (const re of [/--user-data-dir=("[^"]+"|\S+)/i, /--cache-dir=("[^"]+"|\S+)/i, /--model[-_]dir=("[^"]+"|\S+)/i, /-o\s+("([^"]+)"|\S+\.(?:mp4|wav|png|jpg))/i]) {
    const m = re.exec(command)
    if (m && m[1]) paths.push(m[1].replace(/^"|"$/g, ''))
  }
  return paths
}

/** 归类一条命令行 */
export function classifyCommand(command, name = '') {
  if (!command) return []
  if (CHROMIUM_CHILD.test(command)) return []
  const hits = []
  for (const pattern of PATTERNS) {
    if (pattern.nameGate && !pattern.nameGate.test(name)) continue
    if (pattern.re.test(command)) hits.push({ key: pattern.key, label: pattern.label })
  }
  return hits
}

/**
 * 找出所有命中「会持续生长」特征的进程，并还原父进程链。
 */
export async function findWatchedProcesses() {
  const procs = await snapshotProcesses()
  const byPid = new Map(procs.map((proc) => [proc.pid, proc]))
  const hits = []
  for (const proc of procs) {
    const categories = classifyCommand(proc.command, proc.name)
    if (categories.length === 0) continue
    const chain = []
    let cursor = byPid.get(proc.ppid)
    for (let depth = 0; cursor && depth < 4; depth++) {
      chain.push({ pid: cursor.pid, name: cursor.name, command: cursor.command.slice(0, 400) })
      cursor = byPid.get(cursor.ppid)
    }
    const dataDir = /--user-data-dir=("[^"]+"|\S+)/i.exec(proc.command)
    const port = /--remote-debugging-port=(\d+)/i.exec(proc.command)
    hits.push({
      pid: proc.pid,
      name: proc.name,
      command: proc.command.slice(0, 600),
      categories,
      userDataDir: dataDir ? dataDir[1].replace(/^["']|["']*$/g, '') : '',
      port: port ? Number(port[1]) : null,
      paths: pathsOf(proc.command),
      startedAt: proc.startedAt,
      parents: chain,
    })
  }
  return { hits, sampledAt: Date.now(), total: procs.length }
}

/** 兼容旧调用：只关心 CDP */
export async function findCdpLaunchers() {
  const { hits, sampledAt, total } = await findWatchedProcesses()
  const cdp = hits.filter((hit) => hit.categories.some((category) => category.key === 'cdp' || category.key === 'browser-profile'))
  return { hits: cdp, sampledAt, total }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * 采样落盘：新的「发起者 × 类别」记一行（按 pid+类别去重）。
 * @param {{home:string}} opts
 */
export async function sampleWatchedProcesses({ home }) {
  const dir = join(home, 'install-radar')
  const logFile = join(dir, 'proc-watch.jsonl')
  const stateFile = join(dir, 'proc-seen.json')
  await mkdir(dir, { recursive: true })

  const seen = (await readJson(stateFile, {})) || {}
  const { hits, sampledAt, total } = await findWatchedProcesses()
  const added = []
  for (const hit of hits) {
    for (const category of hit.categories) {
      const key = `${category.key}|${hit.pid}`
      if (seen[key]) continue
      seen[key] = sampledAt
      added.push({
        category: category.key,
        label: category.label,
        pid: hit.pid,
        name: hit.name,
        command: hit.command,
        paths: hit.paths,
        userDataDir: hit.userDataDir,
        startedAt: hit.startedAt,
        parents: hit.parents,
      })
    }
  }
  if (added.length > 0) {
    await appendFile(logFile, `${JSON.stringify({ at: sampledAt, added })}\n`, 'utf8')
  }
  const keys = Object.keys(seen)
  if (keys.length > 800) {
    const trimmed = {}
    for (const key of keys.slice(-800)) trimmed[key] = seen[key]
    await writeFile(stateFile, JSON.stringify(trimmed), 'utf8')
  } else {
    await writeFile(stateFile, JSON.stringify(seen), 'utf8')
  }
  return { added, hits, sampledAt, total, logPath: logFile }
}

/** 兼容旧调用名 */
export const sampleCdpLaunchers = sampleWatchedProcesses

/**
 * 读历史，聚合成「发起者 → 类别 → 次数 → 关联路径」的因果表。
 * @param {{home:string, limit?:number}} opts
 */
export async function readProcWatch({ home, limit = 200 }) {
  const logFile = join(home, 'install-radar', 'proc-watch.jsonl')
  let text = ''
  try {
    text = await readFile(logFile, 'utf8')
  } catch {
    return { rows: [], total: 0, logPath: logFile, byCategory: [] }
  }
  const rows = new Map()
  const byCategory = new Map()
  let total = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    for (const item of record.added || []) {
      total++
      const parent = (item.parents || [])[0]
      const launcher = parent ? `${parent.name} (pid ${parent.pid})` : '未知父进程'
      const key = `${launcher}|${item.category}`
      const bucket = rows.get(key) || {
        launcher,
        category: item.category,
        label: item.label,
        count: 0,
        lastAt: 0,
        paths: new Set(),
        samples: [],
        parentCommand: parent?.command || '',
      }
      bucket.count++
      bucket.lastAt = Math.max(bucket.lastAt, record.at || 0)
      for (const path of item.paths || []) bucket.paths.add(path)
      if (item.userDataDir) bucket.paths.add(item.userDataDir)
      if (bucket.samples.length < 2) bucket.samples.push(item.command.slice(0, 160))
      rows.set(key, bucket)

      const cat = byCategory.get(item.category) || { category: item.category, label: item.label, count: 0 }
      cat.count++
      byCategory.set(item.category, cat)
    }
  }
  const list = [...rows.values()]
    .map((bucket) => ({ ...bucket, paths: [...bucket.paths].slice(0, 5) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
  return {
    rows: list,
    total,
    logPath: logFile,
    byCategory: [...byCategory.values()].sort((a, b) => b.count - a.count),
  }
}

/** 兼容旧调用名：只留 cdp / browser-profile */
export async function readCdpHistory({ home, limit = 200 }) {
  const all = await readProcWatch({ home, limit: limit * 4 })
  const rows = all.rows.filter((row) => row.category === 'cdp' || row.category === 'browser-profile')
  return {
    launchers: rows.map((row) => ({
      key: row.launcher,
      count: row.count,
      samples: row.paths,
      lastAt: row.lastAt,
      parentCommand: row.parentCommand,
    })),
    total: rows.reduce((sum, row) => sum + row.count, 0),
    logPath: all.logPath,
  }
}
