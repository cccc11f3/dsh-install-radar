import { assessRisk, assessUninstall, CLEAN_MIN_BYTES } from '../src/engine/risk.js'

const cases = [
  'C:\\Windows\\Temp',
  'C:\\Users\\13737\\AppData\\Local\\Temp',
  'C:\\Windows\\Temp\\cdp-seq-1',
  'C:\\.pnpm-store',
  'C:\\Users\\13737\\Desktop\\a.exe',
  'C:\\Windows\\Installer',
  'C:\\Python314\\Lib\\site-packages\\torch',
  'C:\\Users\\13737\\AppData\\Local\\Temp\\pip-unpack-abc',
]

for (const target of cases) {
  const risk = assessRisk(target, { bytes: 3e9 })
  const cleanable = 3e9 >= CLEAN_MIN_BYTES && risk.level !== 'danger' && risk.isRoot !== true
  console.log(`${risk.level.padEnd(8)} ${(risk.isRoot ? 'ROOT' : '    ')} cleanable=${cleanable ? 'Y' : 'n'}  ${target}`)
}

const uninstallCases = [
  { eco: 'git', name: 'Hunyuan3D-2', path: 'E:\\3DAI' },
  { eco: 'python', name: 'edge-tts', path: 'C:\\Python314\\Lib\\site-packages\\edge_tts' },
  { eco: 'node', name: 'electron', path: 'E:\\x\\node_modules\\electron' },
  { eco: 'winget', name: 'Gyan.FFmpeg', path: '' },
]
for (const item of uninstallCases) {
  const risk = assessUninstall(item)
  console.log(`${risk.level.padEnd(8)} 卸载后果=${risk.consequence.slice(0, 46)}`)
}
