#!/usr/bin/env node
/**
 * install-radar CLI —— 不依赖 DSH 也能跑：
 *   node bin/radar.mjs baseline        取基线（之后新装的都能被 diff 出来）
 *   node bin/radar.mjs scan            扫一遍现状（体积/路径/创建时间）
 *   node bin/radar.mjs sessions        只看会话命令证据（找出历史上装了什么）
 *   node bin/radar.mjs report [--out]  生成完整报告
 *   node bin/radar.mjs roots           看会扫哪些根目录
 * 通用参数：--home <DSH_HOME> --extra <路径> --limit <会话数> --json
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildRecent, buildReport, currentSnapshot, dshHome, readBaseline, renderMarkdown, takeBaseline, stateDir } from '../src/engine/radar.js'
import { resolveRoots } from '../src/engine/roots.js'
import { formatBytes } from '../src/engine/classify.js'

const argv = process.argv.slice(2)
const command = argv[0] || 'report'
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)
const home = flag('home', dshHome())
const extraRoots = []
for (let i = 0; i < argv.length; i++) if (argv[i] === '--extra' && argv[i + 1]) extraRoots.push(argv[i + 1])
const config = extraRoots.length > 0 ? { extraRoots } : {}
const limit = Number(flag('limit', '0')) || 0
const json = has('json')

function out(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`)
}

switch (command) {
  case 'roots': {
    const roots = resolveRoots(config)
    out({ home, stateDir: stateDir(home), roots })
    break
  }
  case 'baseline': {
    const t0 = Date.now()
    const baseline = await takeBaseline({ home, config })
    const bytes = baseline.entries.reduce((sum, entry) => sum + entry.bytes, 0)
    out(
      json
        ? baseline
        : `基线已建立：${baseline.entries.length} 个条目，合计 ${formatBytes(bytes)}，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n写入 ${stateDir(home)}\\baseline.json`,
    )
    break
  }
  case 'scan': {
    const snapshot = await currentSnapshot({ home, config, force: true })
    const bytes = snapshot.entries.reduce((sum, entry) => sum + entry.bytes, 0)
    if (json) out(snapshot)
    else {
      out(`${snapshot.entries.length} 个条目，合计 ${formatBytes(bytes)}`)
      for (const root of snapshot.roots) out(`  ${root.label}: ${root.entries} 条 / ${formatBytes(root.bytes)} / ${root.ms}ms`)
      const top = snapshot.entries.slice(0, 15)
      out('\n最大的 15 项：')
      for (const entry of top) out(`  ${formatBytes(entry.bytes).padStart(9)}  ${entry.name}  (${entry.path})`)
    }
    break
  }
  case 'sessions': {
    const report = await buildReport({ home, config, maxSessions: limit })
    if (json) out(report.perSession)
    else {
      out(`含安装命令的会话：${report.perSession.length} / 扫描 ${report.scannedSessions}`)
      for (const session of report.perSession) {
        out(`\n== ${session.title || session.id}  (${session.items.length} 项, ${formatBytes(session.bytes)})`)
        for (const item of session.items) out(`   ${item.name.padEnd(28)} ${item.size.padStart(9)}  ${item.path || '未找到产物'}  — ${item.purpose}`)
      }
    }
    break
  }
  case 'diff': {
    const baseline = await readBaseline(home)
    const snapshot = await currentSnapshot({ home, config, force: true })
    const { diffSnapshot } = await import('../src/engine/radar.js')
    const delta = diffSnapshot(baseline, snapshot)
    if (json) out(delta)
    else {
      out(`基线：${baseline ? new Date(baseline.takenAt).toLocaleString('sv-SE') : '无'}`)
      out(`新出现：${delta.newEntries.length} 项`)
      for (const entry of delta.newEntries.slice(0, 40)) out(`  + ${formatBytes(entry.bytes).padStart(9)}  ${entry.name}  ${entry.path}`)
      out(`明显变大：${delta.grownEntries.length} 项`)
      for (const entry of delta.grownEntries.slice(0, 40)) out(`  ↑ +${formatBytes(entry.grew).padStart(8)}  ${entry.name}  ${entry.path}`)
    }
    break
  }
  case 'recent': {
    const days = Number(flag('days', '0')) || 0
    const sinceFlag = Number(flag('since', '0')) || 0
    const since = sinceFlag > 0 ? sinceFlag : days > 0 ? Date.now() - days * 86400_000 : undefined
    const recent = await buildRecent({ home, config, since })
    if (json) out(recent)
    else {
      out(`统计起点：${recent.sinceLabel}　合计 ${recent.totalSize} / ${recent.totalFiles} 个文件`)
      out(`扫描根：${recent.roots.map((root) => `${root.label}(${root.ms}ms)`).join(' · ')}`)
      for (const item of recent.items.slice(0, 25)) {
        out('')
        out(`${item.size.padStart(10)}  ${item.path}`)
        out(`            ${item.purpose}`)
        if (item.samples && item.samples[0]) out(`            示例 ${item.samples[0]}`)
      }
    }
    break
  }
  case 'report':
  default: {
    const report = await buildReport({ home, config, maxSessions: limit })
    const markdown = renderMarkdown(report)
    const target = flag('out', '')
    if (target) {
      const file = resolve(target)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, markdown, 'utf8')
      out(`已写入 ${file}`)
      out(`会话 ${report.totals.sessions} · 条目 ${report.totals.items} · 合计 ${report.totals.size}`)
    } else if (json) out(report)
    else out(markdown)
  }
}
