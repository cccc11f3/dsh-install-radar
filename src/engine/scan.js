/**
 * 扫描层：把「可能被装东西的目录」按一级条目（一个应用 / 一个包 / 一个仓库）拆开，
 * 逐条算递归体积、文件数、创建时间。所有条目都是「可归因单元」——
 * 报告里的每一行就是从这里来的。
 */
import { opendir, stat, lstat } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULT_LIMITS = {
  maxFilesPerEntry: 400_000, // 单个条目最多数这么多文件，防病态目录
  maxDepth: 64,
  concurrency: 8,
  skipNames: new Set(['$RECYCLE.BIN', 'System Volume Information', 'Windows', 'WinSxS']),
}

/** 简单并发池 */
export function createPool(limit) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= limit) return
    const job = queue.shift()
    if (!job) return
    active++
    job.fn().then(job.resolve, job.reject).finally(() => {
      active--
      next()
    })
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      next()
    })
}

/**
 * 递归求一个路径的体积。
 * 跳过符号链接 / junction（Windows 上 reparse point 会成环），出错即跳过。
 * @returns {Promise<{bytes:number, files:number, dirs:number, truncated:boolean}>}
 */
export async function measure(target, limits = DEFAULT_LIMITS, budget = { files: 0 }) {
  const out = { bytes: 0, files: 0, dirs: 0, truncated: false }
  const stack = [target]
  while (stack.length > 0) {
    const dir = stack.pop()
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      continue
    }
    out.dirs++
    try {
      for await (const entry of handle) {
        const full = join(dir, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (!entry.isFile()) continue
        try {
          const st = await stat(full)
          out.bytes += st.size
          out.files++
          budget.files++
        } catch {
          /* 权限 / 竞态：忽略 */
        }
        if (budget.files > limits.maxFilesPerEntry) {
          out.truncated = true
          return out
        }
      }
    } catch {
      /* 目录读一半失败：保留已统计部分 */
    }
    if (out.dirs > 200_000) {
      out.truncated = true
      break
    }
  }
  return out
}

/**
 * 扫一个根目录，返回它下面每个一级条目的画像。
 * @param {string} root
 * @param {{depth?:number, limits?:object, pool?:Function}} opts
 */
export async function scanRoot(root, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const depth = opts.depth ?? 1
  const pool = opts.pool || createPool(limits.concurrency)
  const results = []

  let handle
  try {
    handle = await opendir(root)
  } catch {
    return results
  }
  const children = []
  try {
    for await (const entry of handle) {
      if (limits.skipNames.has(entry.name)) continue
      children.push(entry)
    }
  } catch {
    return results
  }

  const jobs = children.map((entry) => async () => {
    const full = join(root, entry.name)
    let st
    try {
      st = await lstat(full)
    } catch {
      return
    }
    if (st.isSymbolicLink()) return
    const base = {
      root,
      name: entry.name,
      path: full,
      isDir: st.isDirectory(),
      mtimeMs: st.mtimeMs,
      birthtimeMs: st.birthtimeMs,
      depth,
    }
    if (!st.isDirectory()) {
      results.push({ ...base, bytes: st.size, files: 1, dirs: 0, truncated: false })
      return
    }
    const m = await measure(full, limits)
    results.push({ ...base, ...m })
  })

  await Promise.all(jobs.map((fn) => pool(fn)))
  results.sort((a, b) => b.bytes - a.bytes)
  return results
}

/**
 * 扫多个根，合并结果。
 * @param {Array<{path:string, depth?:number, label?:string}>} roots
 */
export async function scanRoots(roots, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const pool = createPool(limits.concurrency)
  const entries = []
  const rootReport = []
  for (const root of roots) {
    const started = Date.now()
    const list = await scanRoot(root.path, { limits, pool, depth: root.depth })
    for (const item of list) entries.push({ ...item, label: root.label || root.path })
    rootReport.push({
      path: root.path,
      label: root.label || root.path,
      entries: list.length,
      bytes: list.reduce((sum, item) => sum + item.bytes, 0),
      ms: Date.now() - started,
      missing: list.length === 0,
    })
  }
  return { entries, roots: rootReport, scannedAt: Date.now() }
}
