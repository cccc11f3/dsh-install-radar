/**
 * 增长趋势：按天统计「最近 N 天新写入/新增」的体积，画小柱状图。
 *
 * 与「今天」扫描同一套剪枝规则，但输出按天分桶：
 * 文件取 max(mtime, birthtime) 所在的自然日；目录 birthtime >= since 时整棵计入创建日。
 */
import { opendir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { measure } from './scan.js'

const DEFAULT_LIMITS = {
  maxFilesPerEntry: 400_000,
  maxDepth: 12,
  skipNames: new Set(['$RECYCLE.BIN', 'System Volume Information', 'WinSxS', 'node_modules']),
}

const dayKey = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * @param {Array<{path:string, skip?:string[]}>} roots
 * @param {{days?:number, now?:number, limits?:object}} opts
 */
export async function scanDaily(roots, opts = {}) {
  const days = Number(opts.days) > 0 ? Number(opts.days) : 14
  const now = opts.now ?? Date.now()
  const since = now - days * 86400_000
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const buckets = new Map()

  const bump = (day, bytes, files) => {
    const bucket = buckets.get(day) || { day, bytes: 0, files: 0 }
    bucket.bytes += bytes
    bucket.files += files
    buckets.set(day, bucket)
  }

  async function walk(root, dir, depth) {
    if (depth > limits.maxDepth) return
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      return
    }
    const children = []
    try {
      for await (const entry of handle) {
        if (limits.skipNames.has(entry.name)) continue
        if ((root.skip || []).includes(entry.name)) continue
        children.push(entry)
      }
    } catch {
      return
    }
    for (const entry of children) {
      const full = join(dir, entry.name)
      let st
      try {
        st = await lstat(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (st.birthtimeMs >= since) {
          const m = await measure(full, { ...limits, skipNames: new Set() })
          bump(dayKey(st.birthtimeMs), m.bytes, m.files)
          continue
        }
        if (st.mtimeMs >= since - 3600_000) await walk(root, full, depth + 1)
        continue
      }
      if (!st.isFile()) continue
      const at = Math.max(st.mtimeMs, st.birthtimeMs)
      if (at < since) continue
      bump(dayKey(at), st.size, 1)
    }
  }

  for (const root of roots) {
    try {
      await walk(root, root.path, 0)
    } catch {
      /* 单根失败不影响其余 */
    }
  }

  // 补齐中间没数据的日期，图表才不会断
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(now - i * 86400_000)
    const bucket = buckets.get(key) || { day: key, bytes: 0, files: 0 }
    out.push(bucket)
  }
  return {
    days,
    since,
    generatedAt: now,
    totalBytes: out.reduce((sum, item) => sum + item.bytes, 0),
    totalFiles: out.reduce((sum, item) => sum + item.files, 0),
    maxBytes: out.reduce((max, item) => Math.max(max, item.bytes), 0),
    buckets: out,
  }
}
