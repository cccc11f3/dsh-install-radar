/**
 * 签名推断：知识库没收录时，不瞎猜，去看目录里自己写的自我介绍。
 *   1. package.json 的 name / description
 *   2. Python 的 *.dist-info/METADATA → Name + Summary
 *   3. README.md / README.zh.md 的第一个标题或第一行
 *   4. .git/config 里的 remote url（仓库来源）
 * 只读小文件（<= 256 KB），结果进内存缓存。全程不发网络请求。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const cache = new Map()
const MAX_BYTES = 256 * 1024
const TTL = 60 * 60 * 1000

async function readSmall(file) {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_BYTES) return ''
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

function firstLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, '').replace(/[`*_>]/g, '').trim()
    if (trimmed.length >= 3) return trimmed
  }
  return ''
}

/**
 * @param {string} dir 安装目录
 * @returns {Promise<{purpose:string, from:string}|null>}
 */
export async function inferFromFolder(dir) {
  if (!dir) return null
  const key = dir.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value

  let result = null
  try {
    // 1) Node 包
    const pkgText = await readSmall(join(dir, 'package.json'))
    if (pkgText) {
      try {
        const pkg = JSON.parse(pkgText)
        const description = typeof pkg.description === 'string' ? pkg.description.trim() : ''
        const name = typeof pkg.name === 'string' ? pkg.name : ''
        if (description) result = { purpose: `${name || '该包'}：${description}`, from: 'package.json' }
        else if (name) result = { purpose: `${name}（package.json 未写说明）`, from: 'package.json' }
      } catch {
        /* package.json 坏了就继续往下看 */
      }
    }

    // 2) Python 包
    if (!result) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      const distInfo = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.dist-info'))
      if (distInfo) {
        const meta = await readSmall(join(dir, distInfo.name, 'METADATA'))
        if (meta) {
          const nameMatch = meta.match(/^Name:\s*(.+)$/m)
          const summaryMatch = meta.match(/^Summary:\s*(.+)$/m)
          const name = nameMatch ? nameMatch[1].trim() : ''
          const summary = summaryMatch ? summaryMatch[1].trim() : ''
          if (name || summary) {
            result = { purpose: `${name || '该包'}${summary ? `：${summary}` : '（METADATA 未写 Summary）'}`, from: 'METADATA' }
          }
        }
      }
    }

    // 3) README
    if (!result) {
      for (const name of ['README.zh-CN.md', 'README.zh.md', 'README.md', 'readme.md', 'README', 'README.txt']) {
        const text = await readSmall(join(dir, name))
        if (!text) continue
        const line = firstLine(text)
        if (line) {
          result = { purpose: `未收录，按仓库自述：${line.slice(0, 120)}`, from: name }
          break
        }
      }
    }

    // 4) git 仓库来源
    if (!result) {
      const config = await readSmall(join(dir, '.git', 'config'))
      const url = config.match(/url\s*=\s*(.+)/)
      if (url) result = { purpose: `未收录的代码仓库，来源 ${url[1].trim()}`, from: '.git/config' }
    }
  } catch {
    result = null
  }

  cache.set(key, { at: Date.now(), value: result })
  return result
}
