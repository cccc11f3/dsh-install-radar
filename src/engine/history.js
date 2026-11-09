/**
 * 历史侧写：给「已经发生过的磁盘事件」找现场。
 *
 * 现在已经没有 cdp 进程了，但 303 个 C:\Windows\Temp\cdp-* 目录还在，
 * 每个目录的创建时间就是一次启动的时刻。把这个时刻拿去和当时的会话日志对表：
 *   - 同一时刻附近有会话执行过浏览器/自动化命令 → 高概率
 *   - 附近只有普通命令 → 中/低概率
 *   - 时间窗内没有任何会话命令 → 判定「非会话」
 *
 * 结论只给概率与证据，不写「就是它」。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { collectCommands } from './sessions.js'
import { measure } from './scan.js'

const BROWSER_HINT = /(cdp|chrome|chromium|msedge|playwright|puppeteer|browser|webdriver|remote-debugging|截图|浏览器|自动化)/i

/** 找出所有形如 cdp-…、chrome-profile…、headless… 的临时目录 */
async function listCdpDirs(dirs) {
  const out = []
  for (const dir of dirs) {
    let list
    try {
      list = await readdir(dir)
    } catch {
      continue
    }
    for (const name of list) {
      if (!/^(cdp-|chrome-profile|headless)/i.test(name)) continue
      const full = join(dir, name)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (!info.isDirectory()) continue
      let chromeVersion = ''
      try {
        chromeVersion = (await readFile(join(full, 'Last Version'), 'utf8')).trim()
      } catch {
        chromeVersion = ''
      }
      out.push({ path: full, at: info.birthtimeMs || info.mtimeMs, mtimeMs: info.mtimeMs, chromeVersion })
    }
  }
  out.sort((a, b) => a.at - b.at)
  return out
}

function fmt(ms) {
  return new Date(ms).toLocaleString('sv-SE')
}

/**
 * @param {{home:string, dirs:string[], windowMs?:number, max?:number}} opts
 */
export async function profileCdpHistory({ home, dirs, windowMs = 20 * 60 * 1000, max = 120 }) {
  const cdpDirs = await listCdpDirs(dirs)
  const commands = await collectCommands(home)
  // 只留有可能相关的命令做匹配池：全部命令太吵；但为了找「最近的命令」，需要全量时间轴
  const bySession = new Map()
  for (const command of commands) {
    const bucket = bySession.get(command.sessionId) || []
    bucket.push(command)
    bySession.set(command.sessionId, bucket)
  }

  const rows = []
  for (const dir of cdpDirs) {
    let best = null
    for (const command of commands) {
      const delta = Math.abs((command.time ?? 0) - dir.at)
      if (delta > windowMs) continue
      const browserish = BROWSER_HINT.test(command.command)
      const score = (browserish ? 100 : 40) - delta / 1000 / 60
      if (!best || score > best.score) best = { score, delta, command, browserish }
    }

    let bytes = 0
    try {
      bytes = (await measure(dir.path)).bytes
    } catch {
      bytes = 0
    }

    rows.push({
      path: dir.path,
      at: dir.at,
      atLabel: fmt(dir.at),
      chromeVersion: dir.chromeVersion,
      bytes,
      match: best
        ? {
            sessionId: best.command.sessionId,
            title: best.command.title || best.command.sessionId,
            time: best.command.time,
            timeLabel: fmt(best.command.time),
            deltaSec: Math.round(best.delta / 1000),
            browserish: best.browserish,
            command: best.command.command.split('\n')[0].slice(0, 180),
            probability: best.browserish && best.delta <= 5 * 60 * 1000 ? 'high' : best.browserish ? 'medium' : 'low',
          }
        : null,
    })
  }

  // 按会话聚合：哪个会话最可能是「一直在跑浏览器测试」的那个
  const sessions = new Map()
  for (const row of rows) {
    if (!row.match) continue
    const key = row.match.sessionId
    const bucket = sessions.get(key) || {
      sessionId: key,
      title: row.match.title,
      count: 0,
      bytes: 0,
      firstAt: row.at,
      lastAt: row.at,
      high: 0,
      samples: [],
    }
    bucket.count++
    bucket.bytes += row.bytes
    bucket.firstAt = Math.min(bucket.firstAt, row.at)
    bucket.lastAt = Math.max(bucket.lastAt, row.at)
    if (row.match.probability === 'high') bucket.high++
    if (bucket.samples.length < 3) bucket.samples.push(row.match.command)
    sessions.set(key, bucket)
  }

  const sessionRows = [...sessions.values()].sort((a, b) => b.count - a.count)
  const unmatched = rows.filter((row) => !row.match)

  return {
    windowMs,
    dirsScanned: dirs,
    total: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    sessions: sessionRows,
    unmatched: {
      count: unmatched.length,
      bytes: unmatched.reduce((sum, row) => sum + row.bytes, 0),
      samples: unmatched.slice(0, 5).map((row) => ({ path: row.path, atLabel: row.atLabel })),
    },
    rows: rows.slice(0, max),
  }
}
