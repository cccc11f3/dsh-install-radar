/**
 * 程序清单层：Windows 的「已安装程序」都登记在 Uninstall 注册表键里，
 * 这里一次性把 DisplayName / 版本 / 安装位置 / 估算体积读出来，
 * 用于给 winget / 安装器 / GUI 安装的程序补上位置与体积。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

let cache = { at: 0, value: null }
const TTL = 10 * 60 * 1000

const SCRIPT = `$ErrorActionPreference='SilentlyContinue';
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
);
Get-ItemProperty $paths | Where-Object { $_.DisplayName } |
  Select-Object DisplayName, DisplayVersion, InstallLocation, EstimatedSize, InstallDate |
  ConvertTo-Json -Compress -Depth 3`

function runPowerShell(script, timeout = 30000) {
  return new Promise((done) => {
    const exe = process.platform === 'win32' ? 'powershell.exe' : ''
    if (!exe) return done(null)
    execFile(
      exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => done(error ? null : String(stdout).trim()),
    )
  })
}

const norm = (value) => String(value || '').toLowerCase().replace(/[\s_.\-()（）]/g, '')

/**
 * @returns {Promise<Array<{name,version,location,bytes,installDate,raw}>>}
 */
export async function loadInstalledPrograms({ force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < TTL) return cache.value
  if (process.platform !== 'win32') {
    cache = { at: Date.now(), value: [] }
    return []
  }
  const text = await runPowerShell(SCRIPT)
  if (!text) return cache.value || []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return cache.value || []
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const value = list
    .filter((item) => item && typeof item.DisplayName === 'string' && item.DisplayName.trim())
    .map((item) => {
      const location = typeof item.InstallLocation === 'string' ? item.InstallLocation.trim() : ''
      const estimated = Number(item.EstimatedSize) || 0
      return {
        name: item.DisplayName.trim(),
        version: typeof item.DisplayVersion === 'string' ? item.DisplayVersion.trim() : '',
        location: location && existsSync(location) ? location : '',
        estimatedBytes: estimated > 0 ? estimated * 1024 : 0,
        installDate: typeof item.InstallDate === 'string' ? item.InstallDate : '',
      }
    })
  cache = { at: Date.now(), value }
  return value
}

/**
 * 按名字找已安装程序：精确同名优先，其次包含匹配（要求关键词够长，避免误命中）。
 * @param {string} name
 * @param {Array} programs
 */
export function findProgram(name, programs) {
  const target = norm(name)
  if (!target || target.length < 3) return null
  let best = null
  for (const program of programs) {
    const candidate = norm(program.name)
    if (!candidate) continue
    let score = 0
    if (candidate === target) score = 100
    else if (candidate.startsWith(target) || candidate.endsWith(target)) score = 70
    else if (target.length >= 4 && candidate.includes(target)) score = 45
    else continue
    if (!best || score > best.score) best = { program, score }
  }
  return best?.program ?? null
}
