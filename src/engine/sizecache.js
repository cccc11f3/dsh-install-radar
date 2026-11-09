/**
 * 体积缓存：E:\3DAI 这种 17 GB 的目录量一次就够，不必每次开面板都再数一遍。
 * 缓存落在 $DSH_HOME/install-radar/size-cache.json，30 分钟有效，目录 mtime 变了就重算。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const TTL = 30 * 60 * 1000
const store = new Map()
let cacheFile = ''
let loaded = false
let saveTimer = null
let saving = false

export async function initSizeCache(home) {
  cacheFile = join(home, 'install-radar', 'size-cache.json')
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(await readFile(cacheFile, 'utf8'))
    for (const [key, value] of Object.entries(raw || {})) {
      if (value && typeof value.bytes === 'number') store.set(key, value)
    }
  } catch {
    /* 没有缓存文件就是空缓存 */
  }
}

const keyOf = (path) => String(path || '').toLowerCase()

export function getCachedSize(path, mtimeMs) {
  const hit = store.get(keyOf(path))
  if (!hit) return null
  if (Date.now() - hit.at > TTL) return null
  if (typeof mtimeMs === 'number' && typeof hit.mtimeMs === 'number' && mtimeMs !== hit.mtimeMs) return null
  return hit
}

export function putCachedSize(path, info) {
  store.set(keyOf(path), { ...info, at: Date.now() })
  scheduleSave()
}

function scheduleSave() {
  if (!cacheFile || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void persist()
  }, 1500)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

async function persist() {
  if (!cacheFile || saving) return
  saving = true
  try {
    await mkdir(dirname(cacheFile), { recursive: true })
    const now = Date.now()
    const out = {}
    for (const [key, value] of store) {
      if (now - value.at <= TTL * 4) out[key] = value
    }
    await writeFile(cacheFile, JSON.stringify(out), 'utf8')
  } catch {
    /* 缓存写失败不影响主流程 */
  } finally {
    saving = false
  }
}

export async function flushSizeCache() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await persist()
}
