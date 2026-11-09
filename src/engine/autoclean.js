/**
 * 自动清理：只清「🟢 safe 且够老」的临时垃圾，默认关闭。
 *
 * 与手动清理共用同一套判定（risk.assessRisk）与白名单（clean.checkAllowed），
 * 但更保守：
 *   - 只扫临时目录白名单的**一级子项**（不递归乱翻）
 *   - 只删 risk === 'safe' 的（cdp-*、HeadlessChrome*、pip-unpack-*、安装包…）
 *   - 只删「创建时间早于 N 天前」的（默认 7 天）
 *   - 每条都写 clean-log.jsonl（note=auto），可追溯
 */
import { readdir, stat, rm, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { allowedRoots } from './clean.js'
import { assessRisk, CLEAN_MIN_BYTES } from './risk.js'
import { measure } from './scan.js'

const DAY = 86400_000

/**
 * @param {{home:string, minAgeDays?:number, dryRun?:boolean, maxItems?:number}} opts
 */
export async function autoCleanSweep(opts = {}) {
  const minAgeDays = Number(opts.minAgeDays) > 0 ? Number(opts.minAgeDays) : 7
  const cutoff = (Number(opts.now) > 0 ? Number(opts.now) : Date.now()) - minAgeDays * DAY
  const dryRun = opts.dryRun === true
  const maxItems = Number(opts.maxItems) > 0 ? Number(opts.maxItems) : 60

  const roots = Array.isArray(opts.roots) && opts.roots.length > 0 ? opts.roots : allowedRoots()
  const candidates = []
  let scanned = 0

  for (const root of roots) {
    let list
    try {
      list = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of list) {
      const full = join(root, entry.name)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (!info.isFile() && !info.isDirectory()) continue
      scanned++
      const createdAt = info.birthtimeMs || info.mtimeMs
      if (createdAt > cutoff) continue
      const risk = assessRisk(full, { bytes: info.size })
      if (risk.level !== 'safe') continue
      const bytes = info.isDirectory() ? (await measure(full)).bytes : info.size
      if (bytes < CLEAN_MIN_BYTES) continue
      candidates.push({
        path: full,
        bytes,
        ageDays: Math.floor((Date.now() - createdAt) / DAY),
        consequence: risk.consequence,
      })
    }
  }

  candidates.sort((a, b) => b.bytes - a.bytes)
  const picked = candidates.slice(0, maxItems)

  if (dryRun) {
    return {
      dryRun: true,
      minAgeDays,
      scanned,
      candidates: picked,
      totalBytes: picked.reduce((sum, item) => sum + item.bytes, 0),
      removed: 0,
      freed: 0,
    }
  }

  const removed = []
  for (const item of picked) {
    try {
      await rm(item.path, { recursive: true, force: true })
      removed.push(item)
    } catch {
      /* 正在被占用就跳过，下次采样再试 */
    }
  }
  const freed = removed.reduce((sum, item) => sum + item.bytes, 0)
  if (removed.length > 0) {
    const dir = join(opts.home, 'install-radar')
    await mkdir(dir, { recursive: true })
    await appendFile(
      join(dir, 'clean-log.jsonl'),
      `${JSON.stringify({
        at: Date.now(),
        note: `auto(>${minAgeDays}d, safe)`,
        paths: removed.map((item) => item.path),
        freed,
      })}\n`,
      'utf8',
    )
  }

  return { dryRun: false, minAgeDays, scanned, candidates: picked, totalBytes: picked.reduce((sum, item) => sum + item.bytes, 0), removed: removed.length, freed }
}
