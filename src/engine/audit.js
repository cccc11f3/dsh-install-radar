/**
 * 会话目录审计：给 $DSH_HOME/sessions 建一份索引快照，每次比对，
 * 谁消失了、什么时候消失的、消失前多大，全部追加到 session-audit.jsonl。
 *
 * 起因：2026-11-09 发现两个会话目录（含 FFmpeg 664MB 的安装记录）在无人操作的情况下不见了，
 * 而插件对它只读 —— 那就需要一条能事后追溯的账。
 */
import { readdir, readFile, stat, appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function listSessionDirs(home) {
  const root = join(home, 'sessions')
  const out = []
  let workspaces
  try {
    workspaces = await readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue
    const wsDir = join(root, ws.name)
    let sessions
    try {
      sessions = await readdir(wsDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const dir = join(wsDir, session.name)
      let files
      try {
        files = await readdir(dir)
      } catch {
        continue
      }
      const log = files.find((name) => /^session\..+\.jsonl(\.zstd)?$/i.test(name))
      if (!log) continue
      let info
      try {
        info = await stat(join(dir, log))
      } catch {
        continue
      }
      out.push({
        id: session.name,
        workspace: ws.name,
        path: dir,
        bytes: info.size,
        mtimeMs: info.mtimeMs,
      })
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * @param {{home:string, note?:string}} opts
 * @returns {Promise<{first:boolean, at:number, added:Array, removed:Array, changed:Array, total:number, logPath:string}>}
 */
export async function auditSessions({ home, note = '' }) {
  const stateDir = join(home, 'install-radar')
  const indexFile = join(stateDir, 'session-index.json')
  const logFile = join(stateDir, 'session-audit.jsonl')
  const previous = await readJson(indexFile, null)
  const current = await listSessionDirs(home)
  const at = Date.now()

  const before = new Map((previous?.sessions || []).map((item) => [item.id, item]))
  const after = new Map(current.map((item) => [item.id, item]))

  const added = current.filter((item) => !before.has(item.id))
  const removed = (previous?.sessions || []).filter((item) => !after.has(item.id))
  const changed = current.filter((item) => {
    const old = before.get(item.id)
    return old && old.bytes !== item.bytes
  })

  await mkdir(stateDir, { recursive: true })
  await writeFile(
    indexFile,
    JSON.stringify({ at, sessions: current.map(({ id, workspace, path, bytes, mtimeMs }) => ({ id, workspace, path, bytes, mtimeMs })) }, null, 1),
    'utf8',
  )

  const first = previous === null
  if (!first || added.length > 0 || removed.length > 0) {
    const record = {
      at,
      note,
      first,
      added: added.map(({ id, bytes }) => ({ id, bytes })),
      removed: removed.map(({ id, bytes, mtimeMs }) => ({ id, bytes, lastSeen: mtimeMs })),
      changed: changed.map(({ id, bytes }) => ({ id, bytes })),
    }
    await appendFile(logFile, `${JSON.stringify(record)}\n`, 'utf8')
  }

  return { first, at, added, removed, changed, total: current.length, logPath: logFile }
}
