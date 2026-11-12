/**
 * 清理层：只允许删「临时目录白名单」里的东西，且必须两段式（先预览，再确认）。
 *
 * 白名单 = 系统临时目录 / 用户临时目录 / C:\Temp / TMP 指向的目录。
 * 其它任何路径（Program Files、工作区、模型目录）一律拒绝 —— 这个功能是用来
 * 清 cdp-* 这类垃圾的，不是用来删用户东西的。
 */
import { rm, readdir, stat } from 'node:fs/promises'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { measure } from './scan.js'

function allowedRoots() {
  const roots = new Set()
  if (process.platform === 'win32') {
    roots.add(resolve(process.env.SystemRoot || 'C:\\Windows', 'Temp').toLowerCase())
    roots.add(resolve(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Temp').toLowerCase())
    roots.add(resolve('C:\\Temp').toLowerCase())
  }
  const tmp = (process.env.TMP || process.env.TEMP || '/tmp').trim()
  if (tmp) roots.add(resolve(tmp).toLowerCase())
  return [...roots]
}

/** 判断路径是否落在白名单里（严格前缀 + 至少比根多一级） */
export function checkAllowed(target) {
  if (typeof target !== 'string' || target.length === 0) return { ok: false, reason: '空路径' }
  if (!isAbsolute(target)) return { ok: false, reason: '必须是绝对路径' }
  const real = resolve(target)
  if (real.includes('..')) return { ok: false, reason: '路径里有 ..' }
  const lower = real.toLowerCase()
  for (const root of allowedRoots()) {
    if (lower === root) return { ok: false, reason: '拒绝清理临时目录根本身' }
    if (lower.startsWith(`${root}\\`) || lower.startsWith(`${root}/`)) return { ok: true, root }
  }
  return { ok: false, reason: '不在临时目录白名单内' }
}

/** 把 `C:\Windows\Temp\cdp-seq*` 展开成真实目录列表 */
async function expand(target) {
  if (!target.endsWith('*')) return [target]
  const parent = dirname(target)
  const prefix = target.slice(parent.length + 1, -1)
  try {
    const list = await readdir(parent)
    return list.filter((name) => name.startsWith(prefix)).map((name) => join(parent, name))
  } catch {
    return []
  }
}

/**
 * @param {string[]} paths 面板里选中的路径（可带 * 通配）
 * @param {{confirm?:boolean, home?:string, note?:string}} opts
 */
export async function cleanTargets(paths, opts = {}) {
  const list = Array.isArray(paths) ? paths : []
  const items = []
  for (const raw of list) {
    let expanded = await expand(raw)
    // 临时目录根本身不允许整根删：自动展开成里面的子项，逐个判定
    if (expanded.length === 1 && !checkAllowed(expanded[0]).ok) {
      const root = resolve(expanded[0])
      if (root.toLowerCase() === String(expanded[0]).toLowerCase() && allowedRoots().includes(root.toLowerCase())) {
        try {
          const children = await readdir(root, { withFileTypes: true })
          expanded = children.map((child) => join(root, child.name))
        } catch {
          expanded = []
        }
      }
    }
    if (expanded.length === 0) {
      items.push({ path: raw, ok: false, reason: '没有匹配到目录', bytes: 0 })
      continue
    }
    for (const target of expanded) {
      const allowed = checkAllowed(target)
      if (!allowed.ok) {
        items.push({ path: target, ok: false, reason: allowed.reason, bytes: 0 })
        continue
      }
      let info
      try {
        info = await stat(target)
      } catch {
        items.push({ path: target, ok: false, reason: '不存在', bytes: 0 })
        continue
      }
      let bytes = 0
      if (info.isDirectory()) bytes = (await measure(target)).bytes
      else bytes = info.size
      items.push({ path: target, ok: true, bytes })
    }
  }

  const totalBytes = items.reduce((sum, item) => sum + (item.ok ? item.bytes : 0), 0)
  if (!opts.confirm) {
    return { confirm: false, items, totalBytes, kept: items.filter((item) => item.ok).length }
  }

  const done = []
  for (const item of items) {
    if (!item.ok) continue
    try {
      await rm(item.path, { recursive: true, force: true })
      done.push(item)
    } catch (error) {
      item.ok = false
      item.reason = error?.message || '删除失败'
    }
  }
  const freed = done.reduce((sum, item) => sum + item.bytes, 0)
  if (opts.home) {
    const dir = join(opts.home, 'install-radar')
    await mkdir(dir, { recursive: true })
    await appendFile(
      join(dir, 'clean-log.jsonl'),
      `${JSON.stringify({ at: Date.now(), note: opts.note || 'panel', paths: done.map((item) => item.path), freed })}\n`,
      'utf8',
    )
  }
  return { confirm: true, items, totalBytes, freed, removed: done.length }
}

export { allowedRoots }
