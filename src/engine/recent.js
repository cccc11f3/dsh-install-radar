/**
 * 「今天多出来的」扫描：不依赖基线，直接按文件系统时间戳找最近写入的东西。
 *
 * 为什么需要它：基线只能发现「基线之后新出现的条目」，而 C:\Windows\Temp 这类
 * 根本不在常规监视根里的目录，就算每天堆 17 GB 也永远不会出现在报告里。
 *
 * 规则：
 *   - 文件 mtime 或 birthtime >= since → 计入
 *   - 目录 birthtime >= since → 整个目录计入（不再逐文件判断，直接 measure）
 *   - 目录 mtime < since - 1h 且 birthtime < since → 整棵剪掉（里面不可能有新东西）
 *   - 按「归属方」聚合：root 下 ownerDepth 层目录为一行（默认 1，C:\ 为 2）
 *   - 同一父目录下名字只差数字后缀的兄弟（cdp-seq-9667 …）合并成一行
 */
import { opendir, lstat } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { measure } from './scan.js'

/**
 * 把「同一父目录下、名字只差数字后缀」的兄弟合并成一行。
 * C:\Windows\Temp\cdp-seq-9667 / cdp-eval-9773 … 一共 303 个目录，
 * 不合并的话用户只会看到一屏碎片，而不是「17 GB 全是 cdp-*」这个结论。
 */
function collapseSiblings(items) {
  const groups = new Map()
  const singles = []
  for (const item of items) {
    const parent = dirname(item.path)
    const leaf = basename(item.path)
    const match = leaf.match(/^(.*?)[-_.]?\d{2,}$/)
    if (!match) {
      singles.push(item)
      continue
    }
    const key = `${parent.toLowerCase()}|${match[1]}`
    const bucket = groups.get(key) || {
      path: join(parent, `${match[1]}*`),
      label: item.label,
      pattern: match[1],
      count: 0,
      bytes: 0,
      files: 0,
      newest: 0,
      samples: [],
      children: [],
    }
    bucket.count += 1
    bucket.bytes += item.bytes
    bucket.files += item.files
    bucket.newest = Math.max(bucket.newest, item.newest)
    if (bucket.samples.length < 3) bucket.samples.push(item.path)
    bucket.children.push(item.path)
    groups.set(key, bucket)
  }
  const merged = [...groups.values()].filter((bucket) => bucket.count >= 3)
  const rest = [...groups.values()].filter((bucket) => bucket.count < 3)
  for (const bucket of rest) {
    for (const child of bucket.children) {
      const single = items.find((item) => item.path === child)
      if (single) singles.push(single)
    }
  }
  return [...singles, ...merged].sort((a, b) => b.bytes - a.bytes)
}

const DEFAULT_LIMITS = {
  maxFilesPerEntry: 400_000,
  maxDepth: 12,
  concurrency: 8,
  skipNames: new Set(['$RECYCLE.BIN', 'System Volume Information', 'WinSxS', 'node_modules']),
}

/**
 * @param {Array<{path:string, label?:string, ownerDepth?:number, skip?:string[]}>} roots
 * @param {{since:number, limits?:object, maxItems?:number}} opts
 */
export async function scanRecent(roots, opts = {}) {
  const since = opts.since ?? Date.now() - 24 * 3600 * 1000
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const owners = new Map()

  const ownerOf = (root, target) => {
    const depth = root.ownerDepth ?? 1
    const rel = relative(root.path, target)
    if (!rel || rel.startsWith('..')) return target
    const parts = rel.split(/[\\/]/).filter(Boolean)
    const take = parts.slice(0, Math.max(1, depth))
    return join(root.path, ...take)
  }

  const bump = (owner, bytes, files, at, sample, rootLabel) => {
    const bucket = owners.get(owner) || { path: owner, label: rootLabel || '', bytes: 0, files: 0, newest: 0, samples: [] }
    bucket.bytes += bytes
    bucket.files += files
    if (at > bucket.newest) bucket.newest = at
    if (sample && bucket.samples.length < 5) bucket.samples.push(sample)
    owners.set(owner, bucket)
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
      const owner = ownerOf(root, full)

      if (st.isDirectory()) {
        if (st.birthtimeMs >= since) {
          const m = await measure(full, { ...limits, skipNames: new Set() })
          bump(owner, m.bytes, m.files, st.birthtimeMs, full, root.label)
          continue
        }
        // 目录本身很旧，但内部还在改 → 继续下潜；否则剪枝
        if (st.mtimeMs >= since - 3600_000) await walk(root, full, depth + 1)
        continue
      }

      if (!st.isFile()) continue
      const at = Math.max(st.mtimeMs, st.birthtimeMs)
      if (at < since) continue
      bump(owner, st.size, 1, at, full, root.label)
    }
  }

  for (const root of roots) {
    const started = Date.now()
    try {
      await walk(root, root.path, 0)
    } catch {
      /* 单个根失败不影响其余 */
    }
    root._ms = Date.now() - started
  }

  const collapsed = collapseSiblings([...owners.values()])
  const list = collapsed.sort((a, b) => b.bytes - a.bytes)
  const maxItems = opts.maxItems ?? 60
  return {
    since,
    scannedAt: Date.now(),
    roots: roots.map((root) => ({ path: root.path, label: root.label || root.path, ms: root._ms ?? 0 })),
    totalBytes: list.reduce((sum, item) => sum + item.bytes, 0),
    totalFiles: list.reduce((sum, item) => sum + item.files, 0),
    items: list.slice(0, maxItems),
  }
}
