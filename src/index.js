/**
 * dsh-install-radar —— Cordis 宿主半部分
 *
 * 两个面：
 *   1. Agent 工具（ctx.tools）：
 *        install_radar_report / sessions / baseline / diff / recent / audit
 *   2. 浏览器面板数据接口（ctx.connection.fetch）：/api/install-radar/<method>
 *        report / sessions / baseline / diff / refresh / recent / open
 *      左侧栏图标 + 主面板由 src/client.js 注册，数据只从这里来。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import {
  buildRecent,
  buildReport,
  currentSnapshot,
  diffSnapshot,
  dshHome,
  readBaseline,
  renderMarkdown,
  startOfToday,
  stateDir,
  takeBaseline,
} from './engine/radar.js'
import { resolveRecentRoots } from './engine/roots.js'
import { formatBytes } from './engine/classify.js'
import { suggestUninstall } from './engine/uninstall.js'
import { auditSessions } from './engine/audit.js'
import { readCdpHistory, readProcWatch, sampleCdpLaunchers, sampleWatchedProcesses } from './engine/procs.js'
import { cleanTargets } from './engine/clean.js'
import { profileCdpHistory } from './engine/history.js'
import { assessRisk, assessUninstall, CLEAN_MIN_BYTES } from './engine/risk.js'
import { findReproClues } from './engine/repro.js'
import { collectCommands } from './engine/sessions.js'
import { autoCleanSweep } from './engine/autoclean.js'
import { scanDaily } from './engine/trend.js'
import { readConfig, writeConfig } from './engine/radar.js'

let defineTool
try {
  ;({ defineTool } = await import('@deepseek-ai/dsh-tools'))
} catch {
  defineTool = (tool) => tool
}

export const name = 'install-radar'
export const inject = ['tools']

const ROUTE_PREFIX = '/api/install-radar/'
const METHODS = ['report', 'sessions', 'baseline', 'diff', 'refresh', 'recent', 'open', 'procs', 'clean', 'history', 'repro', 'trend', 'autoclean']

const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true, description: '給模型看的纯文本结果' },
    reportPath: { type: 'string', description: '落盘的 Markdown 报告路径（可能为空）' },
  },
}

const text = (value, extra = {}) => ({ text: value, ...extra })

function sessionConfig(config) {
  return {
    home: config.home || dshHome(),
    config: {
      extraRoots: config.extraRoots || [],
      extraRecentRoots: config.extraRecentRoots || [],
      includeDefaults: config.includeDefaults !== false,
      limits: config.limits,
    },
    maxSessions: config.maxSessions || 0,
  }
}

/** 面板用的精简负载：只带画界面要用的字段，命令只留一行 */
function panelPayload(report) {
  return {
    generatedAt: report.generatedAt,
    host: report.host,
    baselineTakenAt: report.baselineTakenAt,
    baselineAuto: report.baselineAuto ?? null,
    scannedSessions: report.scannedSessions,
    totals: report.totals,
    audit: report.audit,
    perSession: report.perSession.map((session) => ({
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      lastActive: session.lastActive,
      installs: session.installs,
      bytes: session.bytes,
      size: formatBytes(session.bytes),
      items: session.items.map((item) => ({
        name: item.name,
        eco: item.eco,
        size: item.size,
        bytes: item.bytes,
        path: item.path,
        purpose: item.purpose,
        category: item.category,
        confidence: item.confidence,
        note: item.note,
        birthtime: item.birthtime,
        command: item.command ? String(item.command).split('\n')[0].slice(0, 300) : '',
        why: item.why || null,
        uninstall: suggestUninstall(item),
        uninstallRisk: assessUninstall(item),
      })),
    })),
    unattributed: report.unattributed.slice(0, 40).map((entry) => ({
      ...entry,
      uninstall: suggestUninstall({ eco: '', name: entry.name, path: entry.path }),
    })),
  }
}

function renderSessionTable(report) {
  const lines = []
  lines.push(
    `扫描 ${report.scannedSessions} 个会话，其中 ${report.perSession.length} 个有安装动作；共 ${report.totals.items} 个条目，合计 ${report.totals.size}。`,
  )
  for (const session of report.perSession) {
    lines.push('')
    lines.push(`【${session.title || session.id}】${session.cwd}`)
    for (const item of session.items) {
      const conf = item.confidence === 'none' ? '[未找到产物]' : item.confidence === 'low' ? '[推测]' : ''
      lines.push(`  - ${item.name}${conf} | ${item.size} | ${item.path || '—'} | ${item.purpose}`)
      if (item.why && item.why.text) lines.push(`    为什么装: ${item.why.text}`)
      if (item.command) lines.push(`    证据: ${String(item.command).split('\n')[0].slice(0, 120)}`)
    }
  }
  if (report.perSession.length === 0) {
    lines.push('（没有会话留下安装命令的证据。首次使用建议先跑 install_radar_baseline 建立基线，之后由 diff 抓到新装的东西。）')
  }
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  const base = sessionConfig(config)

  /**
   * 复现线索要挑「哪一轮」：优先用历史侧写的第一名；
   * 如果临时目录已经被清掉了，就退回到「浏览器命令最多的那一轮」。
   */
  async function pickSessionForRepro(explicit) {
    if (typeof explicit === 'string' && explicit.length > 0) return { sessionId: explicit, source: 'explicit' }
    const recentRoots = resolveRecentRoots(base.config)
      .map((root) => root.path)
      .filter((path) => /temp/i.test(path))
    const profile = await profileCdpHistory({ home: base.home, dirs: recentRoots, windowMs: 20 * 60 * 1000 })
    const top = profile.sessions[0]?.sessionId
    if (top) return { sessionId: top, source: 'history' }
    const commands = await collectCommands(base.home)
    const counts = new Map()
    for (const command of commands) {
      if (!/chrome\.exe|msedge\.exe|cdp-|remote-debugging|--user-data-dir/i.test(command.command)) continue
      counts.set(command.sessionId, (counts.get(command.sessionId) || 0) + 1)
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    return { sessionId: best, source: 'commands' }
  }

  // ——— Agent 工具 ———
  ctx.tools.register(
    defineTool({
      name: 'install_radar_report',
      description:
        '按会话列出本机新装了哪些依赖/程序（Python 包、npm 包、git 仓库、winget/安装器程序），每项给出体积、安装位置、创建时间、用途与命令证据，并把 Markdown 报告落盘。回答「所有会话都装了什么、多大、装在哪、干什么用」时用这个。首次扫描会遍历 Program Files 等目录，通常 10-60 秒。',
      parameters: {
        writeFile: { type: 'boolean', description: '是否把 Markdown 报告写到 DSH_HOME/install-radar/report.md（默认 true）。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 600000,
      async execute(args) {
        const report = await buildReport({ ...base, includeSessions: true })
        const markdown = renderMarkdown(report)
        let reportPath = ''
        if (args.writeFile !== false) {
          const dir = stateDir(base.home)
          await mkdir(dir, { recursive: true })
          reportPath = join(dir, 'report.md')
          await writeFile(reportPath, markdown, 'utf8')
        }
        return text(renderSessionTable(report), reportPath ? { reportPath } : {})
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_sessions',
      description:
        '只看会话命令证据：哪些会话执行过 pip install / npm install / git clone / winget install 等，分别装了什么、落在哪个路径、多大、干什么用。比 install_radar_report 更快（不写文件），适合追问某个会话装了哪些东西。',
      parameters: {
        keyword: { type: 'string', description: '只看标题/会话 ID/包名里包含这个关键词的会话。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 600000,
      async execute(args) {
        const report = await buildReport({ ...base, includeSessions: true })
        let sessions = report.perSession
        const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : ''
        if (keyword) {
          sessions = sessions.filter(
            (session) =>
              session.title.toLowerCase().includes(keyword) ||
              session.id.toLowerCase().includes(keyword) ||
              session.items.some((item) => item.name.toLowerCase().includes(keyword)),
          )
        }
        return text(renderSessionTable({ ...report, perSession: sessions }))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_recent',
      description:
        '回答「今天/最近 X 天，这块盘多出来的空间是谁吃的」：不走基线，直接按文件系统时间戳扫系统临时目录、用户临时目录、Local/Roaming、下载、桌面和 C 盘根，按归属目录聚合体积（同名数字后缀的兄弟目录会合并，例如 Temp\\cdp-* 303 个目录算一行），并给出示例路径。查「C 盘莫名少了 20G」用这个。',
      parameters: {
        days: { type: 'number', description: '看最近多少天，默认 3；传 0 表示只看今天零点起。' },
        since: { type: 'number', description: '自定义起点（毫秒时间戳），优先级高于 days。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 900000,
      async execute(args) {
        const days = args.days === undefined ? 3 : Number(args.days) || 0
        const from = Number(args.since) > 0 ? Number(args.since) : days > 0 ? Date.now() - days * 86400_000 : startOfToday()
        const recent = await buildRecent({ ...base, since: from })
        const lines = [
          `统计起点：${recent.sinceLabel}`,
          `合计 ${recent.totalSize} / ${recent.totalFiles} 个文件，扫描 ${recent.roots.length} 个根。`,
        ]
        for (const item of recent.items.slice(0, 20)) {
          lines.push('')
          lines.push(`${item.size}  ${item.path}`)
          lines.push(`  · ${item.purpose}`)
          if (item.samples && item.samples.length > 0) lines.push(`  · 示例：${item.samples[0]}`)
        }
        return text(lines.join('\n'))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_baseline',
      description:
        '把「此刻本机装了什么」记成基线（DSH_HOME/install-radar/baseline.json）。装东西之前跑一次，之后 install_radar_diff 就能指出新增了哪些程序/依赖（包括用 GUI 安装器、便携解压这类没有命令痕迹的安装）。',
      parameters: {},
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 600000,
      async execute() {
        const baseline = await takeBaseline(base)
        const bytes = baseline.entries.reduce((sum, entry) => sum + entry.bytes, 0)
        return text(`基线已建立：${baseline.entries.length} 个条目，合计 ${formatBytes(bytes)}。之后新装的东西可用 install_radar_diff 查看。`)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_diff',
      description:
        '对比基线：列出基线以来新出现的程序/依赖条目（含体积、路径、创建时间）以及体积明显变大的目录。没有基线时先提示建立基线。',
      parameters: {
        limit: { type: 'integer', description: '每类最多返回多少条，默认 30。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 600000,
      async execute(args) {
        const baseline = await readBaseline(base.home)
        if (!baseline) {
          return text('还没有基线。先执行 install_radar_baseline 记下当前状态，之后新装的东西才能被对比出来。')
        }
        const snapshot = await currentSnapshot({ ...base, force: true })
        const delta = diffSnapshot(baseline, snapshot)
        const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(200, args.limit)) : 30
        const lines = [`基线时间：${new Date(baseline.takenAt).toLocaleString('sv-SE')}`]
        lines.push(`新出现 ${delta.newEntries.length} 项：`)
        for (const entry of delta.newEntries.slice(0, limit)) {
          lines.push(`  + ${formatBytes(entry.bytes)}  ${entry.name}  ${entry.path}`)
        }
        lines.push(`明显变大 ${delta.grownEntries.length} 项：`)
        for (const entry of delta.grownEntries.slice(0, limit)) {
          lines.push(`  ↑ +${formatBytes(entry.grew)}  ${entry.name}  ${entry.path}`)
        }
        return text(lines.join('\n'))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_audit',
      description:
        '会话目录审计：把 $DSH_HOME/sessions 下每个会话目录（大小、最后修改）记成索引，每次比对并追加到 session-audit.jsonl。用来回答「某个会话怎么不见了 / 什么时间消失的 / 消失前有多大」。',
      parameters: {},
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 120000,
      async execute() {
        const result = await auditSessions({ home: base.home, note: 'tool' })
        const lines = [
          result.first
            ? `首次记录：${result.total} 个会话目录，已建索引（${result.logPath}）。`
            : `当前 ${result.total} 个会话目录；新增 ${result.added.length}、消失 ${result.removed.length}、体积变化 ${result.changed.length}。`,
        ]
        for (const item of result.removed) {
          lines.push(`  - ${item.id}（消失前 ${formatBytes(item.bytes)}，最后修改 ${new Date(item.mtimeMs).toLocaleString('sv-SE')}）`)
        }
        for (const item of result.added) lines.push(`  + ${item.id}（${formatBytes(item.bytes)}）`)
        return text(lines.join('\n'))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_history',
      description:
        '历史侧写：对已经不在的进程做回溯——把磁盘上遗留的 cdp-* / chrome-profile 临时目录按创建时间，与会话日志里当时的 shell 命令对表，给出「哪个会话最可能反复拉起浏览器」的概率结论与证据。只给概率，不写死结论。',
      parameters: {
        windowMinutes: { type: 'number', description: '时间窗（分钟），默认 20。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 600000,
      async execute(args) {
        const windowMinutes = Number(args.windowMinutes) || 20
        const recentRoots = resolveRecentRoots(base.config)
          .map((root) => root.path)
          .filter((path) => /temp/i.test(path) || /^[A-Z]:\\$/i.test(path))
        const result = await profileCdpHistory({ home: base.home, dirs: recentRoots, windowMs: windowMinutes * 60 * 1000 })
        const lines = [
          `扫描 ${result.total} 个遗留目录，合计 ${formatBytes(result.totalBytes)}；时间窗 ±${windowMinutes} 分钟。`,
          `能对上会话的 ${result.total - result.unmatched.count} 个，对不上的 ${result.unmatched.count} 个。`,
        ]
        if (result.sessions.length > 0) {
          lines.push('', '按会话聚合（概率 = 时间邻近 + 命令里出现浏览器特征）：')
          for (const row of result.sessions.slice(0, 8)) {
            lines.push(
              `  ${row.count}×  ${row.title}  ${formatBytes(row.bytes)}  高置信 ${row.high} 次  ${new Date(row.firstAt).toLocaleString('sv-SE')} → ${new Date(row.lastAt).toLocaleString('sv-SE')}`,
            )
            if (row.samples[0]) lines.push(`     证据：${row.samples[0]}`)
          }
        }
        return text(lines.join('\n'))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_procs',
      description:
        '进程命令行审计（因果表）：抓 Win32_Process 完整命令行，不只认 CDP，还认 --user-data-dir、npm/pnpm install、pip install、模型下载、构建、ffmpeg 等「会持续往磁盘堆东西」的命令行；按「发起者 → 类别 → 次数 → 关联路径」聚合，并把路径与磁盘占用对账。宿主每 90 秒自动采一次，历史落在 proc-watch.jsonl。',
      parameters: {},
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 300000,
      async execute() {
        const sample = await sampleWatchedProcesses({ home: base.home })
        const watch = await readProcWatch({ home: base.home })
        const lines = [
          `本次采样 ${sample.total} 个进程，命中「会写盘」特征 ${sample.hits.length} 个；历史累计 ${watch.total} 次。`,
        ]
        if (watch.byCategory.length > 0) {
          lines.push('', '按类别：' + watch.byCategory.map((row) => `${row.label}×${row.count}`).join(' · '))
        }
        if (watch.rows.length > 0) {
          lines.push('', '因果表（发起者 → 类别）：')
          for (const row of watch.rows.slice(0, 12)) {
            lines.push(`  ${row.count}×  ${row.launcher} → ${row.label}`)
            if (row.parentCommand) lines.push(`     ${row.parentCommand.slice(0, 160)}`)
            if (row.paths[0]) lines.push(`     path: ${row.paths[0]}`)
          }
        } else {
          lines.push('', `还没有历史采样（日志：${watch.logPath}），宿主运行期间每 90 秒采一次。`)
        }
        return text(lines.join('\n'))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_repro',
      description:
        '复现线索：从「最可能留下 cdp-* 临时目录的那一轮会话」里，把真正在跑浏览器自动化的脚本揪出来（命令里出现过的 .js/.py/.ps1，读内容找 CDP 特征），并判断它有没有自己清理临时 profile；没清理的给一段可直接粘贴的清理钩子。',
      parameters: {
        sessionId: { type: 'string', description: '指定会话 id；不传则用历史侧写里排名第一的那个。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 300000,
      async execute(args) {
        const picked = await pickSessionForRepro(args.sessionId)
        const result = await findReproClues({ home: base.home, sessionId: picked.sessionId })
        const lines = [
          picked.source === 'commands'
            ? `遗留临时目录已经清空，改用「浏览器命令最多的一轮」：会话 ${result.sessionId}（${result.commands} 条命令）。`
            : `会话 ${result.sessionId}：${result.commands} 条命令。`,
        ]
        if (result.note) lines.push(`说明：${result.note}`)
        for (const item of result.candidates) {
          lines.push('')
          lines.push(`${item.path}`)
          lines.push(`  · 在命令里出现 ${item.usedInCommands} 次；${item.verdict}`)
          for (const line of item.cdpLines) lines.push(`  · 证据：${line}`)
          if (item.hook) lines.push('', '  清理钩子建议：', ...item.hook.split('\n').map((line) => `    ${line}`))
        }
        if (result.candidates.length === 0 && !result.note) lines.push('没有找到带 CDP 特征的脚本。')
        return text(lines.join('\n'))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'install_radar_autoclean',
      description:
        '自动清理开关与执行：只清「🟢 safe 且创建时间超过 N 天（默认 7）」的临时垃圾（cdp-*、HeadlessChrome*、pip-unpack-*、安装包…），默认关闭。传 dryRun=true 只看会删什么不真删；传 enabled=true/false 切换定时清理（宿主每 90 秒采样时顺带执行）。',
      parameters: {
        enabled: { type: 'boolean', description: '是否开启定时自动清理。' },
        minAgeDays: { type: 'integer', description: '多少天之前的才清，默认 7。' },
        dryRun: { type: 'boolean', description: '只预览不删。' },
      },
      output: { schema: OUTPUT, render: (_args, value) => [{ type: 'text', text: value.text }] },
      timeoutMs: 300000,
      async execute(args) {
        const config = await readConfig(base.home)
        const settings = { enabled: false, minAgeDays: 7, ...(config.autoClean || {}) }
        if (args.enabled !== undefined) settings.enabled = args.enabled === true
        if (args.minAgeDays !== undefined) settings.minAgeDays = Math.max(1, Math.min(365, Number(args.minAgeDays) || 7))
        await writeConfig(base.home, { autoClean: settings })
        const dryRun = args.dryRun === true || args.enabled === undefined
        const result = await autoCleanSweep({ home: base.home, minAgeDays: settings.minAgeDays, dryRun })
        const lines = [
          `自动清理：${settings.enabled ? '已开启' : '已关闭'} · 只清 ${settings.minAgeDays} 天前的 🟢 safe 项。`,
          `扫描 ${result.scanned} 个临时目录项，命中 ${result.candidates.length} 个，合计 ${formatBytes(result.totalBytes)}。`,
        ]
        for (const item of result.candidates.slice(0, 12)) {
          lines.push(`  ${formatBytes(item.bytes)}  ${item.path}（${item.ageDays} 天前）`)
        }
        if (!dryRun) lines.push(`已删除 ${result.removed} 项，释放 ${formatBytes(result.freed)}。`)
        else lines.push('（预览模式，未删除任何文件）')
        return text(lines.join('\n'))
      },
    }),
  )

  // ——— 后台采样：钉住「谁在拉起 CDP / Chrome」 ———
  if (process.platform === 'win32' && config.cdpSampler !== false) {
    ctx.effect(() => {
      const timer = setInterval(async () => {
        try {
          await sampleWatchedProcesses({ home: base.home })
        } catch {
          /* 采样失败不影响下一轮 */
        }
        try {
          const current = await readConfig(base.home)
          const auto = current.autoClean || {}
          if (auto.enabled === true) {
            await autoCleanSweep({ home: base.home, minAgeDays: auto.minAgeDays || 7 })
          }
        } catch {
          /* 自动清理失败就算了，绝不影响宿主 */
        }
      }, 90_000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    }, 'install-radar: sampler + auto clean')
  }

  // ——— 面板数据接口（左侧栏面板只认这几个） ———
  ctx.inject(['connection'], (browserCtx) => {
    const connection = browserCtx.get('connection')
    const register = connection && connection.fetch && connection.fetch.register
    if (typeof register !== 'function') return

    let cached = { at: 0, value: null }

    async function reportPayload(force) {
      const ttl = 45_000
      if (!force && cached.value && Date.now() - cached.at < ttl) return cached.value
      const report = await buildReport({ ...base, includeSessions: true, force })
      const value = panelPayload(report)
      const config = await readConfig(base.home)
      value.autoClean = { enabled: false, minAgeDays: 7, ...(config.autoClean || {}) }
      cached = { at: Date.now(), value }
      return value
    }

    let trendCache = { at: 0, value: null }

    const handlers = {
      async report() {
        return reportPayload(false)
      },
      async refresh() {
        return reportPayload(true)
      },
      async sessions() {
        const value = await reportPayload(false)
        return { sessions: value.perSession, totals: value.totals, scannedSessions: value.scannedSessions }
      },
      async baseline() {
        const baseline = await takeBaseline(base)
        cached = { at: 0, value: null }
        const bytes = baseline.entries.reduce((sum, entry) => sum + entry.bytes, 0)
        return { takenAt: baseline.takenAt, entries: baseline.entries.length, bytes, size: formatBytes(bytes) }
      },
      async diff() {
        const baseline = await readBaseline(base.home)
        if (!baseline) return { baselineTakenAt: null, newEntries: [], grownEntries: [] }
        const snapshot = await currentSnapshot({ ...base, force: true })
        const delta = diffSnapshot(baseline, snapshot)
        return {
          baselineTakenAt: baseline.takenAt,
          newEntries: delta.newEntries.slice(0, 100).map((entry) => ({
            name: entry.name,
            path: entry.path,
            bytes: entry.bytes,
            size: formatBytes(entry.bytes),
            birthtime: entry.birthtimeMs,
          })),
          grownEntries: delta.grownEntries.slice(0, 100).map((entry) => ({
            name: entry.name,
            path: entry.path,
            bytes: entry.bytes,
            size: formatBytes(entry.bytes),
            grew: entry.grew,
            grewSize: formatBytes(entry.grew),
          })),
        }
      },
      async recent(body) {
        const payload = body?.payload || {}
        const since = Number(payload.since)
        const days = payload.days === undefined ? 3 : Number(payload.days) || 0
        const from = Number.isFinite(since) && since > 0 ? since : days > 0 ? Date.now() - days * 86400_000 : startOfToday()
        return buildRecent({ ...base, since: from, maxItems: 60 })
      },
      async procs() {
        const sample = await sampleWatchedProcesses({ home: base.home })
        const watch = await readProcWatch({ home: base.home })
        const recent = await buildRecent({ ...base, since: Date.now() - 7 * 86400_000, maxItems: 200 })
        // 因果表：把「发起者 → 类别」的路径跟磁盘占用对上
        const causal = watch.rows.map((row) => {
          const disk = []
          for (const path of row.paths) {
            const hit = recent.items.find((item) => item.path.toLowerCase().startsWith(path.toLowerCase()))
            if (hit) disk.push({ path: hit.path, size: hit.size, bytes: hit.bytes })
          }
          return { ...row, disk, current: sample.hits.filter((hit) => hit.categories.some((c) => c.key === row.category)).length }
        })
        return {
          sampledAt: sample.sampledAt,
          processes: sample.total,
          liveHits: sample.hits.length,
          logPath: watch.logPath,
          totalSamples: watch.total,
          byCategory: watch.byCategory,
          causal,
          cdp: (await readCdpHistory({ home: base.home })).launchers.slice(0, 10),
        }
      },
      async history(body) {
        const payload = body?.payload || {}
        const windowMinutes = Number(payload.windowMinutes) || 20
        const recentRoots = resolveRecentRoots(base.config)
          .map((root) => root.path)
          .filter((path) => /temp/i.test(path) || /^[A-Z]:\\$/i.test(path))
        return profileCdpHistory({
          home: base.home,
          dirs: recentRoots.length > 0 ? recentRoots : undefined,
          windowMs: windowMinutes * 60 * 1000,
        })
      },
      async trend(body) {
        const payload = body?.payload || {}
        const days = Math.max(3, Math.min(30, Number(payload.days) || 14))
        if (trendCache.value && trendCache.value.days === days && Date.now() - trendCache.at < 5 * 60_000) {
          return trendCache.value
        }
        const roots = resolveRecentRoots(base.config)
        const value = await scanDaily(roots, { days })
        trendCache = { at: Date.now(), value }
        return value
      },
      async autoclean(body) {
        const payload = body?.payload || {}
        const config = await readConfig(base.home)
        const settings = { enabled: false, minAgeDays: 7, ...(config.autoClean || {}) }
        if (payload.enabled !== undefined) settings.enabled = payload.enabled === true
        if (payload.minAgeDays !== undefined) settings.minAgeDays = Math.max(1, Math.min(365, Number(payload.minAgeDays) || 7))
        await writeConfig(base.home, { autoClean: settings })
        let result = null
        if (payload.dryRun === true || payload.runNow === true) {
          result = await autoCleanSweep({ home: base.home, minAgeDays: settings.minAgeDays, dryRun: payload.dryRun === true })
        }
        return { autoClean: settings, result }
      },
      async repro(body) {
        const payload = body?.payload || {}
        const picked = await pickSessionForRepro(payload.sessionId)
        if (!picked.sessionId) return { sessionId: '', pickedBy: picked.source, commands: 0, candidates: [], inline: null, note: '没有可回溯的会话' }
        const result = await findReproClues({ home: base.home, sessionId: picked.sessionId })
        return { ...result, pickedBy: picked.source }
      },
      async clean(body) {
        const payload = body?.payload || {}
        const paths = Array.isArray(payload.paths) ? payload.paths.slice(0, 50) : []
        const confirm = payload.confirm === true
        const result = await cleanTargets(paths, { confirm, home: base.home, note: 'panel' })
        for (const item of result.items) {
          const risk = assessRisk(item.path, { bytes: item.bytes })
          item.risk = risk.level
          item.consequence = risk.consequence
          item.cleanable = item.bytes >= CLEAN_MIN_BYTES && risk.level !== 'danger'
        }
        if (confirm && (result.freed || 0) > 0) cached = { at: 0, value: null }
        return result
      },
      async open(body) {        const target = body?.payload?.path
        const select = body?.payload?.select !== false
        if (typeof target !== 'string' || target.length === 0) throw new Error('缺少 path')
        const wildcard = target.endsWith('*')
        const real = wildcard ? dirname(target) : target
        if (!existsSync(real)) throw new Error(`路径不存在：${real}`)
        const isDir = statSync(real).isDirectory()
        if (isDir) {
          spawn('explorer.exe', [real], { detached: true, stdio: 'ignore' }).unref()
        } else {
          spawn('explorer.exe', [select ? `/select,${real}` : dirname(real)], { detached: true, stdio: 'ignore' }).unref()
        }
        return { ok: true, opened: real }
      },
    }

    for (const method of METHODS) {
      register({
        path: `${ROUTE_PREFIX}${method}`,
        methods: ['POST'],
        fetch: async (request) => {
          if (request.method !== 'POST') return new Response('not found', { status: 404 })
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
          try {
            const value = await handlers[method](body)
            return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
          } catch (error) {
            return Response.json({
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'internal', message: error?.message || String(error), details: {} } },
            })
          }
        },
      })
    }
  })
}
