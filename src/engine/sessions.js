/**
 * 会话日志层：DSH 把每个会话写成 session.v<N>.jsonl.zstd，
 * 每行（每个事件）是一个独立的 zstd 帧。这里逐帧解压，只取需要的字段。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { extractInstalls, looksLikeInstall } from './commands.js'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const LOG_NAME = /^session\..+\.jsonl(\.zstd)?$/i

/** 从一条消息里取纯文本（user/assistant 两种结构都吃） */
function textOf(data) {
  const content = data?.message?.content ?? data?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && typeof part.text === 'string' && (part.type === 'text' || part.type === 'reasoning'))
    .map((part) => part.text)
    .join('\n')
}

/**
 * 「为什么装它」：优先用 agent 自己写的命令行说明，其次从它当时的推理/说明里挑一句，
 * 最后退回用户那句话。只挑一句，读起来像人话。
 */
function pickWhy({ description, assistantText, userText, names }) {
  const clean = (text) => String(text || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  if (description && clean(description).length >= 6) {
    return { kind: 'agent-note', text: clean(description).slice(0, 200) }
  }
  const sentences = clean(assistantText)
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .filter((line) => line.length >= 8)
  const keywords = [...(names || []), 'install', '安装', '装', '依赖', 'SDK', '环境', '库', 'clone', '拉取']
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    if (keywords.some((word) => lower.includes(String(word).toLowerCase()))) {
      return { kind: 'assistant', text: sentence.slice(0, 200) }
    }
  }
  if (sentences.length > 0) return { kind: 'assistant', text: sentences[sentences.length - 1].slice(0, 200) }
  const user = clean(userText)
  if (user.length >= 6) return { kind: 'user', text: user.slice(0, 200) }
  return null
}

/** 逐帧解压（帧与帧首尾相接，直接整块解压只会拿到第一帧） */
export function decodeSessionBuffer(buf) {
  if (!buf || buf.length === 0) return []
  const isZstd = buf.subarray(0, 4).equals(MAGIC)
  let text
  if (!isZstd) {
    text = buf.toString('utf8')
  } else {
    const offsets = []
    let i = 0
    while ((i = buf.indexOf(MAGIC, i)) !== -1) {
      offsets.push(i)
      i += 4
    }
    const chunks = []
    for (let k = 0; k < offsets.length; k++) {
      const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
      try {
        chunks.push(zstdDecompressSync(buf.subarray(offsets[k], end)).toString('utf8'))
      } catch {
        /* 坏帧（写入中）：跳过 */
      }
    }
    text = chunks.join('\n')
  }
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      /* 半行：跳过 */
    }
  }
  return events
}

/** 列出所有会话日志文件 */
export async function listSessionFiles(dshHome) {
  const root = join(dshHome, 'sessions')
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
      const log = files.find((name) => LOG_NAME.test(name))
      if (!log) continue
      const file = join(dir, log)
      let info
      try {
        info = await stat(file)
      } catch {
        continue
      }
      out.push({
        id: session.name,
        workspace: ws.name,
        file,
        mtimeMs: info.mtimeMs,
        bytes: info.size,
      })
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * 从一个会话日志里抽出「安装事件」，并带上会话身份与时间。
 * @returns {Promise<{id, title, cwd, createdAt, installs: Array}>}
 */
export async function readSessionInstalls(file, meta = {}) {
  const buf = await readFile(file)
  const events = decodeSessionBuffer(buf)
  let cwd = ''
  let createdAt
  let title = ''
  let lastUserText = ''
  let lastAssistantText = ''
  const installs = []
  for (const event of events) {
    if (event.type === 'session') {
      cwd = typeof event.cwd === 'string' ? event.cwd : cwd
      createdAt = event.createdAt ?? createdAt
      continue
    }
    if (event.type === 'session/title' && typeof event.data?.title === 'string') {
      title = event.data.title
      continue
    }
    if (event.type === 'user/message') {
      const text = textOf(event.data)
      if (text.trim().length > 0) lastUserText = text
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data)
      if (text.trim().length > 0) lastAssistantText = text
      continue
    }
    if (event.type !== 'tool/call') continue
    const name = event.data?.name
    if (name !== 'pwsh' && name !== 'bash') continue
    let args
    try {
      args = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments
    } catch {
      continue
    }
    const command = args?.command
    if (typeof command !== 'string' || !looksLikeInstall(command)) continue
    const parsed = extractInstalls(command)
    if (parsed.length === 0) continue
    installs.push({
      time: event.time,
      turn: event.data.turn,
      step: event.data.step,
      callId: event.data.callId,
      cwd: typeof args.cwd === 'string' ? args.cwd : cwd,
      events: parsed,
      command: command.length > 600 ? `${command.slice(0, 600)}…` : command,
      description: typeof args.description === 'string' ? args.description : '',
      why: pickWhy({
        description: typeof args.description === 'string' ? args.description : '',
        assistantText: lastAssistantText,
        userText: lastUserText,
        names: parsed.flatMap((item) => item.names || []),
      }),
    })
  }
  installs.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  return {
    id: meta.id || '',
    workspace: meta.workspace || '',
    file,
    title,
    cwd,
    createdAt,
    messageCount: events.length,
    installs,
  }
}

/**
 * 只要「所有 shell 调用」，用来给磁盘事件做时间侧写（不限于安装命令）。
 * @returns {Promise<Array<{sessionId, title, cwd, time, command}>>}
 */
export async function collectCommands(home, { limit = 0 } = {}) {
  const files = await listSessionFiles(home)
  const selected = limit > 0 ? files.slice(0, limit) : files
  const out = []
  for (const item of selected) {
    let events
    try {
      events = decodeSessionBuffer(await readFile(item.file))
    } catch {
      continue
    }
    let cwd = ''
    let title = ''
    for (const event of events) {
      if (event.type === 'session') {
        cwd = typeof event.cwd === 'string' ? event.cwd : cwd
        continue
      }
      if (event.type === 'session/title' && typeof event.data?.title === 'string') {
        title = event.data.title
        continue
      }
      if (event.type !== 'tool/call') continue
      const name = event.data?.name
      if (name !== 'pwsh' && name !== 'bash') continue
      let args
      try {
        args = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments
      } catch {
        continue
      }
      if (typeof args?.command !== 'string' || args.command.length === 0) continue
      out.push({
        sessionId: item.id,
        title,
        cwd: typeof args.cwd === 'string' ? args.cwd : cwd,
        time: event.time,
        command: args.command,
      })
    }
  }
  out.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  return out
}

/** 扫全部会话，汇总安装事件 */export async function collectSessionInstalls(dshHome, { limit = 0, since } = {}) {
  const files = await listSessionFiles(dshHome)
  const selected = limit > 0 ? files.slice(0, limit) : files
  const sessions = []
  for (const item of selected) {
    try {
      const parsed = await readSessionInstalls(item.file, item)
      if (since && parsed.installs.every((entry) => (entry.time ?? 0) < since)) continue
      if (parsed.installs.length > 0) sessions.push({ ...parsed, mtimeMs: item.mtimeMs })
    } catch {
      /* 单个会话读失败不影响整体 */
    }
  }
  sessions.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
  return { sessions, scannedSessions: selected.length }
}
