/**
 * 默认监视根：这些位置是「装东西会落到的地方」。
 * 每个根按一级条目切分，一条 = 一个应用 / 一个包 / 一个仓库。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const isWin = process.platform === 'win32'

function winRoots() {
  const home = homedir()
  const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming')
  const programData = process.env.ProgramData || 'C:\\ProgramData'
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return [
    { label: 'Program Files', path: 'C:\\Program Files' },
    { label: 'Program Files (x86)', path: 'C:\\Program Files (x86)' },
    { label: '用户程序目录', path: join(local, 'Programs') },
    { label: 'Roaming 数据', path: roaming },
    { label: 'Local 数据', path: local },
    { label: '系统临时目录', path: join(systemRoot, 'Temp') },
    { label: '用户临时目录', path: join(local, 'Temp') },
    { label: '系统安装缓存', path: join(systemRoot, 'Installer') },
    { label: 'ProgramData', path: programData },
    { label: '用户主目录', path: home },
    { label: 'winget 便携包', path: join(local, 'Microsoft', 'WinGet', 'Packages') },
    { label: 'chocolatey 包', path: join(programData, 'chocolatey', 'lib') },
    { label: 'npm 全局', path: join(roaming, 'npm', 'node_modules') },
    { label: 'pip 用户包', path: join(roaming, 'Python') },
    { label: 'conda base', path: join(home, 'miniconda3') },
    { label: 'conda base(anaconda)', path: join(home, 'anaconda3') },
    { label: 'ComfyUI', path: join(home, 'ComfyUI') },
    { label: 'Ollama 模型', path: join(home, '.ollama', 'models') },
    { label: '用户 .cache', path: join(home, '.cache') },
    { label: '用户 .local/bin', path: join(home, '.local', 'bin') },
    { label: 'cargo bin', path: join(home, '.cargo', 'bin') },
  ]
}

/**
 * 「今天多了什么」专用根：只扫最容易被各种工具偷偷写满的地方。
 * ownerDepth 决定一行代表多大的范围（C:\ 用 2 层，其余 1 层）。
 */
export function resolveRecentRoots(config = {}) {
  const home = homedir()
  const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming')
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  if (!isWin) {
    return [
      { label: 'Root', path: '/', ownerDepth: 3 },
      { label: 'Home', path: home, ownerDepth: 1 },
      { label: 'tmp', path: '/tmp', ownerDepth: 1 },
    ].filter((root) => existsSync(root.path))
  }
  const roots = [
    { label: '系统临时目录', path: join(systemRoot, 'Temp'), ownerDepth: 1 },
    { label: '用户临时目录', path: join(local, 'Temp'), ownerDepth: 1 },
    { label: 'Local', path: local, ownerDepth: 1 },
    { label: 'Roaming', path: roaming, ownerDepth: 1 },
    { label: '下载', path: join(home, 'Downloads'), ownerDepth: 1 },
    { label: '桌面', path: join(home, 'Desktop'), ownerDepth: 1 },
    { label: 'C 盘', path: 'C:\\', ownerDepth: 2, skip: ['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', '$Recycle.Bin'] },
  ]
  const extra = (config.extraRecentRoots || []).map((item) => (typeof item === 'string' ? { path: item, ownerDepth: 2 } : item))
  return [...roots, ...extra].filter((root) => root.path && existsSync(root.path))
}


function posixRoots() {
  const home = homedir()
  return [
    { label: 'Applications', path: '/Applications' },
    { label: 'Homebrew Cellar', path: '/opt/homebrew/Cellar' },
    { label: 'npm 全局', path: '/usr/local/lib/node_modules' },
    { label: '用户 bin', path: join(home, '.local', 'bin') },
    { label: 'ComfyUI', path: join(home, 'ComfyUI') },
    { label: 'Ollama 模型', path: join(home, '.ollama', 'models') },
    { label: '用户 .cache', path: join(home, '.cache') },
  ]
}

/**
 * 合并「默认根 + 配置里的额外根」，丢掉不存在与显式 skip 的。
 * @param {{extraRoots?: Array<string|{path:string,label?:string,depth?:number}>, includeDefaults?: boolean}} config
 */
export function resolveRoots(config = {}) {
  const base = config.includeDefaults === false ? [] : isWin ? winRoots() : posixRoots()
  const extra = (config.extraRoots || []).map((item) =>
    typeof item === 'string' ? { path: item } : { ...item },
  )
  const all = [...base, ...extra].filter((root) => root && root.path && !root.skip)
  const seen = new Set()
  const out = []
  for (const root of all) {
    const key = isWin ? root.path.toLowerCase() : root.path
    if (seen.has(key)) continue
    seen.add(key)
    if (!existsSync(root.path)) continue
    out.push({ label: root.label || root.path, path: root.path, depth: root.depth ?? 1 })
  }
  return out
}
