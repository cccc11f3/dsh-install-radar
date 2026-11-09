/**
 * 编排层：快照 → 会话归因 → 解析路径 → 分类 → 报告。
 * 插件工具与 CLI 都只调这里。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, hostname } from 'node:os'
import { scanRoots } from './scan.js'
import { resolveRoots, resolveRecentRoots } from './roots.js'
import { scanRecent } from './recent.js'
import { collectSessionInstalls } from './sessions.js'
import { probeEnvironment, resolveInstall } from './resolve.js'
import { loadInstalledPrograms } from './registry.js'
import { initSizeCache } from './sizecache.js'
import { auditSessions } from './audit.js'
import { inferFromFolder } from './signature.js'
import { assessRisk, CLEAN_MIN_BYTES } from './risk.js'
import { classify, formatBytes } from './classify.js'

export function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured || join(homedir(), '.dsh')
}

export function stateDir(home = dshHome()) {
  return join(home, 'install-radar')
}

/** 读插件配置（$DSH_HOME/install-radar/config.json） */
export async function readConfig(home = dshHome()) {
  return readJson(join(stateDir(home), 'config.json'), {})
}

/** 合并写配置，返回写后的完整配置 */
export async function writeConfig(home = dshHome(), patch = {}) {
  const current = await readConfig(home)
  const next = { ...current, ...patch }
  await writeJson(join(stateDir(home), 'config.json'), next)
  return next
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 1), 'utf8')
}

let memoryCache = { at: 0, value: null }

/** 取当前快照：有缓存（TTL）就用缓存，避免一次对话里反复扫盘 */
export async function currentSnapshot(opts = {}) {
  const home = opts.home || dshHome()
  const ttl = opts.cacheTtlMs ?? 10 * 60 * 1000
  if (!opts.force && memoryCache.value && Date.now() - memoryCache.at < ttl) return memoryCache.value
  const config = opts.config || (await readJson(join(stateDir(home), 'config.json'), {}))
  const roots = resolveRoots(config)
  const scanned = await scanRoots(roots, { limits: config.limits })
  const snapshot = { ...scanned, home, host: hostname() }
  await writeJson(join(stateDir(home), 'latest.json'), snapshot)
  memoryCache = { at: Date.now(), value: snapshot }
  return snapshot
}

/** 立基线：以当前时刻为「干净状态」 */
export async function takeBaseline(opts = {}) {
  const home = opts.home || dshHome()
  const snapshot = opts.snapshot || (await currentSnapshot({ ...opts, home, force: true }))
  const rootsKey = snapshot.roots
    .map((root) => String(root.path).toLowerCase())
    .sort()
    .join('|')
  const baseline = {
    takenAt: Date.now(),
    host: snapshot.host,
    roots: snapshot.roots,
    rootsKey,
    entries: snapshot.entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      label: entry.label,
      bytes: entry.bytes,
      files: entry.files,
      isDir: entry.isDir,
    })),
  }
  await writeJson(join(stateDir(home), 'baseline.json'), baseline)
  return baseline
}

/**
 * 自动基线：没有基线、或者监视根变了（新增/删除目录）就自己重立一次。
 * 用户不需要记得点「立基线」——这正是上一版漏掉 Windows\Temp 之后加的自愈逻辑。
 * @returns {{baseline:object|null, auto:'first-run'|'roots-changed'|null}}
 */
export async function ensureBaseline(opts = {}) {
  const home = opts.home || dshHome()
  const snapshot = await currentSnapshot({ ...opts, home })
  const rootsKey = snapshot.roots
    .map((root) => String(root.path).toLowerCase())
    .sort()
    .join('|')
  const baseline = await readBaseline(home)
  if (baseline && baseline.rootsKey === rootsKey && Array.isArray(baseline.entries) && baseline.entries.length > 0 && !opts.force) {
    return { baseline, auto: null }
  }
  const taken = await takeBaseline({ ...opts, home, snapshot })
  return { baseline: taken, auto: baseline ? 'roots-changed' : 'first-run' }
}

export async function readBaseline(home = dshHome()) {
  return readJson(join(stateDir(home), 'baseline.json'), null)
}

const key = (path) => String(path || '').toLowerCase()

/** 快照对比：新出现的条目 + 明显变大的条目 */
export function diffSnapshot(baseline, snapshot) {
  const result = { newEntries: [], grownEntries: [], baselineTakenAt: baseline?.takenAt ?? null }
  if (!baseline) return result
  const before = new Map(baseline.entries.map((entry) => [key(entry.path), entry]))
  for (const entry of snapshot.entries) {
    const old = before.get(key(entry.path))
    if (!old) {
      result.newEntries.push(entry)
      continue
    }
    const grew = entry.bytes - old.bytes
    if (grew > Math.max(1_000_000, old.bytes * 0.05)) {
      result.grownEntries.push({ ...entry, grew })
    }
  }
  result.newEntries.sort((a, b) => b.bytes - a.bytes)
  result.grownEntries.sort((a, b) => b.grew - a.grew)
  return result
}

/**
 * 生成完整报告。
 * @param {{home?:string, includeSessions?:boolean, since?:number, force?:boolean, maxSessions?:number}} opts
 */
export async function buildReport(opts = {}) {
  const home = opts.home || dshHome()
  await initSizeCache(home)
  const snapshot = await currentSnapshot({ ...opts, home })
  const ensured = await ensureBaseline({ ...opts, home, snapshot })
  const baseline = ensured.baseline
  const delta = diffSnapshot(baseline, snapshot)
  const env = await probeEnvironment()
  const programs = await loadInstalledPrograms()

  let sessions = []
  let scannedSessions = 0
  if (opts.includeSessions !== false) {
    const collected = await collectSessionInstalls(home, { since: opts.since, limit: opts.maxSessions ?? 0 })
    sessions = collected.sessions
    scannedSessions = collected.scannedSessions
  }

  let audit = null
  try {
    audit = await auditSessions({ home, note: 'report' })
  } catch {
    audit = null
  }

  const perSession = []
  let inferred = 0
  for (const session of sessions) {
    const items = []
    for (const install of session.installs) {
      const resolved = await resolveInstall(install, snapshot.entries, env, programs)
      for (const item of resolved) {
        const info = classify(item.name, item.path)
        let purpose = info.purpose
        let purposeFrom = '知识库'
        if (!info.known && item.path && inferred < 40) {
          const guess = await inferFromFolder(item.path)
          if (guess) {
            purpose = `${guess.purpose}（按 ${guess.from} 判断）`
            purposeFrom = guess.from
            inferred++
          }
        }
        items.push({
          name: item.name,
          eco: item.eco,
          action: item.action || '',
          path: item.path,
          bytes: item.bytes,
          size: formatBytes(item.bytes),
          birthtime: item.birthtimeMs || null,
          category: info.category,
          purpose,
          purposeFrom,
          confidence: item.confidence,
          note: item.note || '',
          command: item.evidence || install.command,
          why: install.why || null,
          time: install.time,
        })
      }
    }
    if (items.length === 0) continue
    const seen = new Set()
    const deduped = items.filter((item) => {
      const id = `${key(item.path)}|${item.name}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    perSession.push({
      id: session.id,
      title: session.title || '',
      cwd: session.cwd || '',
      lastActive: session.mtimeMs ?? null,
      installs: session.installs.length,
      items: deduped,
      bytes: deduped.reduce((sum, item) => sum + item.bytes, 0),
    })
  }
  perSession.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))

  const unattributed = delta.newEntries.slice(0, 60).map((entry) => {
    const info = classify(entry.name, entry.path)
    return {
      name: entry.name,
      path: entry.path,
      bytes: entry.bytes,
      size: formatBytes(entry.bytes),
      birthtime: entry.birthtimeMs || null,
      category: info.category,
      purpose: info.purpose,
      root: entry.label,
    }
  })

  const report = {
    generatedAt: Date.now(),
    host: snapshot.host,
    home,
    baselineTakenAt: baseline?.takenAt ?? null,
    baselineAuto: ensured.auto,
    roots: snapshot.roots,
    env,
    scannedSessions,
    totals: {
      sessions: perSession.length,
      installCommands: perSession.reduce((sum, s) => sum + s.installs, 0),
      items: perSession.reduce((sum, s) => sum + s.items.length, 0),
      bytes: perSession.reduce((sum, s) => sum + s.bytes, 0),
      newEntries: delta.newEntries.length,
      grownEntries: delta.grownEntries.length,
    },
    perSession,
    unattributed,
    audit: audit
      ? {
          at: audit.at,
          total: audit.total,
          first: audit.first,
          added: audit.added.length,
          removed: audit.removed.map((item) => ({ id: item.id, bytes: item.bytes, size: formatBytes(item.bytes), lastSeen: item.mtimeMs })),
          logPath: audit.logPath,
        }
      : null,
  }
  report.totals.size = formatBytes(report.totals.bytes)
  await writeJson(join(stateDir(home), 'report.json'), report)
  return report
}

/** 今天零点（本地时区） */
export function startOfToday(now = Date.now()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * 「今天多了什么」：不依赖基线，按时间戳扫最近写入的目录。
 * 这是基线漏掉的那条路的补丁——比如 C:\Windows\Temp 里堆出来的东西。
 */
export async function buildRecent(opts = {}) {
  const home = opts.home || dshHome()
  const config = opts.config || (await readJson(join(stateDir(home), 'config.json'), {}))
  const roots = resolveRecentRoots(config)
  const since = opts.since ?? startOfToday()
  const raw = await scanRecent(roots, { since, maxItems: opts.maxItems ?? 60, limits: config.recentLimits })
  for (const item of raw.items) {
    const info = classify(item.path.split(/[\\/]/).filter(Boolean).pop() || '', item.path)
    item.category = info.category
    item.purpose = info.purpose
    item.size = formatBytes(item.bytes)
    item.samples = item.samples.slice(0, 3)
    const risk = assessRisk(item.path, { bytes: item.bytes })
    item.risk = risk.level
    item.consequence = risk.consequence
    item.cleanable = item.bytes >= CLEAN_MIN_BYTES && risk.level !== 'danger' && risk.isRoot !== true
  }
  raw.sinceLabel = new Date(raw.since).toLocaleString('sv-SE')
  raw.totalSize = formatBytes(raw.totalBytes)
  return raw
}

/** 渲染为 Markdown 报告 */
export function renderMarkdown(report) {
  const lines = []
  const at = (ms) => (ms ? new Date(ms).toLocaleString('sv-SE') : '未知')
  lines.push('# 会话安装雷达 · 报告')
  lines.push('')
  lines.push(`- 生成时间：${at(report.generatedAt)}`)
  lines.push(`- 主机：${report.host}`)
  lines.push(`- 基线：${report.baselineTakenAt ? at(report.baselineTakenAt) : '尚未建立（只能看到会话命令证据）'}`)
  lines.push(`- 扫描会话：${report.scannedSessions} 个，含安装命令的会话 ${report.totals.sessions} 个`)
  lines.push(`- 安装条目：${report.totals.items} 项，合计 ${report.totals.size}`)
  lines.push('')
  lines.push('## 按会话')
  for (const session of report.perSession) {
    lines.push('')
    lines.push(`### ${session.title || session.id}`)
    lines.push('')
    lines.push(`- 会话 ID：\`${session.id}\``)
    lines.push(`- 工作目录：\`${session.cwd || '未知'}\``)
    lines.push(`- 最近活动：${at(session.lastActive)} · 安装命令 ${session.installs} 条 · 合计 ${formatBytes(session.bytes)}`)
    lines.push('')
    lines.push('| 装了什么 | 类型 | 体积 | 安装位置 | 创建时间 | 用途 | 证据 |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const item of session.items) {
      const conf = item.confidence === 'none' ? '（未找到产物）' : item.confidence === 'low' ? '（推测）' : ''
      lines.push(
        `| ${item.name}${conf} | ${item.eco} | ${item.size} | \`${item.path || '—'}\` | ${at(item.birthtime)} | ${item.purpose} | \`${(item.command || '').split('\n')[0].slice(0, 90)}\` |`,
      )
    }
  }
  if (report.unattributed.length > 0) {
    lines.push('')
    lines.push('## 基线以来新出现（无命令证据，可能是 GUI 安装器 / 手动操作）')
    lines.push('')
    lines.push('| 条目 | 根 | 体积 | 路径 | 创建时间 | 用途 |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const entry of report.unattributed) {
      lines.push(`| ${entry.name} | ${entry.root} | ${entry.size} | \`${entry.path}\` | ${at(entry.birthtime)} | ${entry.purpose} |`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export { formatBytes, classify }
