/**
 * 归因层：把「装了 X」这个名字，落到磁盘上一个真实路径，并取到体积。
 * 顺序：生态约定路径 → 注册表已安装程序 → 快照里同名条目 → 放弃（标记未找到）。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve as resolvePath, isAbsolute, basename } from 'node:path'
import { stat, readdir } from 'node:fs/promises'
import { measure } from './scan.js'
import { loadInstalledPrograms, findProgram } from './registry.js'
import { getCachedSize, putCachedSize } from './sizecache.js'

const IS_WIN = process.platform === 'win32'

function run(cmd, args, timeout = 8000) {
  return new Promise((done) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (error, stdout) => {
        done(error ? null : String(stdout).trim())
      })
    } catch {
      done(null)
    }
  })
}

/** 一次性探测本机 Python / npm 的真实安装位置，避免逐包猜路径 */
export async function probeEnvironment() {
  const env = { pythonPurelib: '', pythonUserSite: '', npmGlobalRoot: '', pythonVersion: '' }
  const pyOut = await run('python', [
    '-c',
    'import sysconfig,sys;print(sysconfig.get_paths().get("purelib",""));print(sys.version.split()[0])',
  ])
  if (pyOut) {
    const [purelib, version] = pyOut.split(/\r?\n/)
    env.pythonPurelib = purelib || ''
    env.pythonVersion = version || ''
  }
  const userSite = await run('python', ['-m', 'site', '--user-site'])
  if (userSite) env.pythonUserSite = userSite
  if (IS_WIN) {
    const npmRoot = await run('npm', ['root', '-g'], 15000)
    if (npmRoot) env.npmGlobalRoot = npmRoot
    if (!env.npmGlobalRoot && process.env.APPDATA) {
      const guess = join(process.env.APPDATA, 'npm', 'node_modules')
      if (existsSync(guess)) env.npmGlobalRoot = guess
    }
  } else {
    env.npmGlobalRoot = '/usr/local/lib/node_modules'
  }
  return env
}

const norm = (value) => String(value || '').toLowerCase().replace(/[\s_.\-]/g, '')

function safeResolve(base, target) {
  if (!target) return ''
  const cleaned = String(target).replace(/^['"]|['"]$/g, '').trim()
  if (!cleaned) return ''
  if (isAbsolute(cleaned)) return cleaned
  return base ? resolvePath(base, cleaned) : ''
}

/** site-packages 里按包名找目录（严格：叶名归一化后相等） */
async function findInSitePackages(siteDir, name) {
  if (!siteDir || !existsSync(siteDir)) return ''
  const target = norm(name)
  try {
    const list = await readdir(siteDir, { withFileTypes: true })
    const hit = list.find((entry) => entry.isDirectory() && norm(entry.name) === target)
    return hit ? join(siteDir, hit.name) : ''
  } catch {
    return ''
  }
}

/** winget 包目录里按 id 找 */
async function findWinget(id) {
  const dir = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  if (!existsSync(dir) || !id) return ''
  try {
    const list = await readdir(dir)
    const hit = list.find((entry) => norm(entry).startsWith(norm(id)))
    return hit ? join(dir, hit) : ''
  } catch {
    return ''
  }
}

/** 快照里严格同名（叶名归一化相等）的目录 */
function matchSnapshotExact(snapshot, name) {
  const target = norm(name)
  if (!target) return null
  let best = null
  for (const entry of snapshot) {
    if (norm(entry.name) !== target) continue
    if (!best || entry.bytes > best.bytes) best = entry
  }
  return best
}

async function describePath(path) {
  const st = await stat(path)
  const cached = getCachedSize(path, st.mtimeMs)
  if (cached) return cached
  let info
  if (st.isDirectory()) {
    const m = await measure(path)
    info = { bytes: m.bytes, files: m.files, isDir: true, birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs }
  } else {
    info = { bytes: st.size, files: 1, isDir: false, birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs }
  }
  putCachedSize(path, info)
  return info
}

/**
 * 把一条安装事件解析成磁盘条目。
 * @param {object} install 来自 sessions.js 的安装事件
 * @param {Array} snapshot 当前快照条目
 * @param {object} env probeEnvironment() 的结果
 * @param {Array} programs 已安装程序清单（registry.js）
 */
export async function resolveInstall(install, snapshot, env, programs = []) {
  const out = []
  const seen = new Set()

  for (const parsed of install.events) {
    const base = parsed.cwdHint || install.cwd || ''
    const subjects = parsed.names.length > 0 ? parsed.names : [parsed.outPath, parsed.url].filter(Boolean)

    for (const name of subjects) {
      let path = ''
      let confidence = 'low'
      let note = ''
      let bytes = 0
      let files = 0
      let isDir = false
      let birthtimeMs = null

      // 1) 生态约定路径
      if (parsed.eco === 'python') {
        const leaf = name.replace(/[-.]/g, '_')
        for (const dir of [env.pythonPurelib, env.pythonUserSite]) {
          const hit = await findInSitePackages(dir, name)
          if (hit) {
            path = hit
            confidence = 'high'
            break
          }
          if (dir && existsSync(join(dir, name))) {
            path = join(dir, name)
            confidence = 'high'
            break
          }
          if (dir && existsSync(join(dir, leaf))) {
            path = join(dir, leaf)
            confidence = 'high'
            break
          }
        }
        // 发行名 ≠ import 名（tencentcloud-sdk-python-ai3d → tencentcloud）：按前缀逐段退化
        if (!path) {
          const parts = name.split(/[-.]/).filter(Boolean)
          for (let take = parts.length - 1; take >= 1 && !path; take--) {
            const guess = parts.slice(0, take).join('_')
            for (const dir of [env.pythonPurelib, env.pythonUserSite]) {
              if (!dir) continue
              const candidate = join(dir, guess)
              if (existsSync(candidate)) {
                path = candidate
                confidence = 'medium'
                note = `发行名 ${name} 的 import 包按前缀定位为 ${guess}`
                break
              }
            }
          }
        }
      } else if (parsed.eco === 'node') {
        const global = env.npmGlobalRoot ? join(env.npmGlobalRoot, name) : ''
        const local = base ? join(base, 'node_modules', name) : ''
        if (global && existsSync(global)) {
          path = global
          confidence = 'high'
        } else if (local && existsSync(local)) {
          path = local
          confidence = 'high'
        }
      } else if (parsed.eco === 'winget') {
        path = await findWinget(name)
        if (path) confidence = 'high'
      } else if (parsed.eco === 'choco') {
        const p = join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'lib', name)
        if (existsSync(p)) {
          path = p
          confidence = 'high'
        }
      } else if (parsed.eco === 'git') {
        const explicit = safeResolve(base, parsed.outPath || '')
        const byCwd = base ? join(base, name) : ''
        if (explicit && existsSync(explicit)) {
          path = explicit
          confidence = parsed.outPath ? 'high' : 'medium'
        } else if (byCwd && existsSync(byCwd)) {
          path = byCwd
          confidence = 'medium'
        } else if (parsed.cwdHint && base === parsed.cwdHint && existsSync(base) && ['package.json', 'README.md', 'requirements.txt', 'pyproject.toml', '.git'].some((marker) => existsSync(join(base, marker)))) {
          // 命令里显式 cd 到了某个目录、克隆内容摊平在里面（没有同名子目录）
          path = base
          confidence = 'low'
          note = '仓库内容被放入该目录，没有同名子目录'
        }
      } else if (parsed.eco === 'python-env' || parsed.eco === 'conda') {
        const explicit = safeResolve(base, parsed.outPath || name)
        if (explicit && existsSync(explicit)) {
          path = explicit
          confidence = 'high'
        }
      }

      // 2) 注册表：已安装程序清单（GUI 程序 / 安装器 / winget 都不一定留在固定目录）
      if (!path) {
        let program = findProgram(name, programs)
        // winget id 形如 Publisher.Product：发布者前缀会挡住匹配，去掉再试一次
        if (!program && name.includes('.')) {
          const tail = name.split('.').filter(Boolean).pop()
          if (tail && tail.length >= 4) program = findProgram(tail, programs)
        }
        if (program) {
          if (program.location) {
            path = program.location
            confidence = 'medium'
            note = `注册表登记名：${program.name}${program.version ? ` v${program.version}` : ''}`
          } else if (program.estimatedBytes > 0) {
            bytes = program.estimatedBytes
            confidence = 'medium'
            note = `注册表估算体积（${program.name}），安装位置未登记`
          }
        }
      }

      // 3) 快照里严格同名
      if (!path && !bytes) {
        const hit = matchSnapshotExact(snapshot, name)
        if (hit) {
          path = hit.path
          bytes = hit.bytes
          files = hit.files ?? 0
          isDir = hit.isDir
          birthtimeMs = hit.birthtimeMs ?? null
          confidence = 'medium'
          note = '按名称在当前快照里匹配到'
        }
      }

      if (path && bytes === 0) {
        try {
          const info = await describePath(path)
          bytes = info.bytes
          files = info.files
          isDir = info.isDir
          birthtimeMs = info.birthtimeMs
        } catch {
          path = ''
        }
      }

      // 下载 / 远程脚本这类，没有落盘产物就不必出现在报告里
      const nothing = !path && bytes === 0
      if (nothing && (parsed.eco === 'download' || parsed.eco === 'remote-script')) continue
      if (nothing && seen.has(name)) continue
      seen.add(name)

      out.push({
        name: name || parsed.action,
        path,
        bytes,
        files,
        isDir,
        birthtimeMs,
        confidence: nothing ? 'none' : confidence,
        eco: parsed.eco,
        action: parsed.action,
        evidence: parsed.segment || install.command?.split('\n').find(Boolean) || '',
        note: nothing
          ? parsed.eco === 'remote-script'
            ? '远程脚本安装，产物位置未知'
            : '未在本机找到对应产物'
          : note,
      })
    }
  }
  return out
}

export { basename, norm }
