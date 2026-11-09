/**
 * 宿主半部分的冒烟测试：不开 DSH，只验证
 *   - apply() 注册了四个工具
 *   - apply() 注册了 /api/install-radar/* 五条路由
 *   - report 路由真的能返回结构正确的 JSON（会真扫一次盘）
 * 用法：node test/host-smoke.mjs
 */
const tools = []
const routes = []

const connection = {
  fetch: {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
}

const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  inject: (deps, fn) => fn({ get: (name) => (name === 'connection' ? connection : undefined) }),
  effect: (fn) => fn(),
  on: () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const mod = await import('../src/index.js')
mod.apply(ctx, { extraRoots: [], includeDefaults: true })

const toolNames = tools.map((tool) => tool.name)
const expectedTools = ['install_radar_report', 'install_radar_sessions', 'install_radar_baseline', 'install_radar_diff']
for (const expected of expectedTools) {
  if (!toolNames.includes(expected)) throw new Error(`tool missing: ${expected}`)
}

const paths = routes.map((route) => route.path)
for (const method of ['report', 'sessions', 'baseline', 'diff', 'refresh']) {
  const expected = `/api/install-radar/${method}`
  if (!paths.includes(expected)) throw new Error(`route missing: ${expected}`)
}

const reportRoute = routes.find((route) => route.path === '/api/install-radar/report')
const started = Date.now()
const response = await reportRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rpcId: 'smoke-1', payload: {} }),
  }),
)
const body = await response.json()
if (body.type !== 'server-response' || body.rpcId !== 'smoke-1') throw new Error('bad rpc envelope')
if (body.result.ok !== true) throw new Error(`route failed: ${JSON.stringify(body.result.error || {})}`)

const value = body.result.value
if (!value.totals || !Array.isArray(value.perSession)) throw new Error('bad payload shape')
const sample = value.perSession.flatMap((session) => session.items)[0]

// 自动基线：报告里应带 baselineAuto（first-run / roots-changed / null）
if (!('baselineAuto' in value)) throw new Error('report payload missing baselineAuto')

// 进程命令行审计路由：真跑一次采样
const procsRoute = routes.find((route) => route.path === '/api/install-radar/procs')
const procsRes = await procsRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/procs', { method: 'POST', body: JSON.stringify({ rpcId: 'smoke-procs' }) }),
)
const procsBody = await procsRes.json()
if (procsBody.result.ok !== true) throw new Error('procs route failed')
if (!Array.isArray(procsBody.result.value.causal)) throw new Error('procs payload missing causal table')

// 清理路由：预览模式，拿一个必然不存在的路径做负向验证
const cleanRoute = routes.find((route) => route.path === '/api/install-radar/clean')
const cleanRes = await cleanRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/clean', {
    method: 'POST',
    body: JSON.stringify({ rpcId: 'smoke-clean', payload: { paths: ['C:\\Windows\\Temp\\__radar_should_not_exist__'] } }),
  }),
)
const cleanBody = await cleanRes.json()
if (cleanBody.result.ok !== true) throw new Error('clean route failed')
const cleaned = cleanBody.result.value
if (cleaned.confirm !== false) throw new Error('clean preview must not delete')
if (!cleaned.items[0] || cleaned.items[0].ok !== false) throw new Error('clean preview accepted a bogus path')

// 白名单外的路径必须被拒
const outsideRes = await cleanRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/clean', {
    method: 'POST',
    body: JSON.stringify({ rpcId: 'smoke-clean2', payload: { paths: ['C:\\Program Files\\Google'] } }),
  }),
)
const outsideBody = await outsideRes.json()
const outsideItem = outsideBody.result.value.items[0]
if (outsideItem.ok !== false) throw new Error('clean accepted a path outside the temp whitelist')

// 历史侧写路由：真跑一次（会读 300+ 个临时目录 + 全部会话命令）
const historyRoute = routes.find((route) => route.path === '/api/install-radar/history')
const historyRes = await historyRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/history', { method: 'POST', body: JSON.stringify({ rpcId: 'smoke-hist' }) }),
)
const historyBody = await historyRes.json()
if (historyBody.result.ok !== true) throw new Error('history route failed')
const profile = historyBody.result.value
if (typeof profile.total !== 'number') throw new Error('history payload missing total')

const reproRoute = routes.find((route) => route.path === '/api/install-radar/repro')
const reproRes = await reproRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/repro', { method: 'POST', body: JSON.stringify({ rpcId: 'smoke-repro' }) }),
)
const reproBody = await reproRes.json()
if (reproBody.result.ok !== true) throw new Error('repro route failed')
const repro = reproBody.result.value
if (!Array.isArray(repro.candidates)) throw new Error('repro payload missing candidates')

// 多选：一次提交多条路径（预览模式，不删）
const { mkdir, writeFile, rm } = await import('node:fs/promises')
const { join } = await import('node:path')
const probeDir = join(process.env.TEMP || process.cwd(), '__radar_batch_probe__')
await mkdir(probeDir, { recursive: true })
await writeFile(join(probeDir, 'x.txt'), 'x'.repeat(4096))
const batchRes = await cleanRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/clean', {
    method: 'POST',
    body: JSON.stringify({ rpcId: 'smoke-batch', payload: { paths: [probeDir, 'C:\\Windows\\Temp\\__nope__'], confirm: false } }),
  }),
)
const batchBody = await batchRes.json()
const batchItems = batchBody.result.value.items
if (batchItems.length !== 2) throw new Error('batch preview did not handle 2 paths')
if (!batchItems.some((item) => item.ok) || !batchItems.some((item) => !item.ok)) throw new Error('batch preview should mix accept/reject')
for (const item of batchItems) if (!item.consequence) throw new Error('batch preview missing consequence')
if (!(await import('node:fs')).existsSync(probeDir)) throw new Error('preview must not delete')
await rm(probeDir, { recursive: true, force: true })

// 趋势：14 天分桶
const trendRoute = routes.find((route) => route.path === '/api/install-radar/trend')
const trendRes = await trendRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/trend', { method: 'POST', body: JSON.stringify({ rpcId: 'smoke-trend' }) }),
)
const trendBody = await trendRes.json()
if (trendBody.result.ok !== true) throw new Error('trend route failed')
const trend = trendBody.result.value
if (!Array.isArray(trend.buckets) || trend.buckets.length !== 14) throw new Error('trend must return 14 buckets')

// 自动清理：开关保存 + 预览模式（不删）
const autocleanRoute = routes.find((route) => route.path === '/api/install-radar/autoclean')
const acRes = await autocleanRoute.fetch(
  new Request('http://127.0.0.1/api/install-radar/autoclean', {
    method: 'POST',
    body: JSON.stringify({ rpcId: 'smoke-ac', payload: { enabled: false, minAgeDays: 7, dryRun: true } }),
  }),
)
const acBody = await acRes.json()
if (acBody.result.ok !== true) throw new Error('autoclean route failed')
const ac = acBody.result.value
if (ac.autoClean.enabled !== false || ac.autoClean.minAgeDays !== 7) throw new Error('autoclean settings not persisted')
if (ac.result.dryRun !== true) throw new Error('autoclean dry run flag missing')

console.log('  trend:', `${trend.days} 天 · 合计 ${(trend.totalBytes / 1024 ** 3).toFixed(1)} GB · 峰值 ${(trend.maxBytes / 1024 ** 3).toFixed(1)} GB`)
console.log('  autoclean:', `enabled=${ac.autoClean.enabled} minAgeDays=${ac.autoClean.minAgeDays} 预览命中 ${ac.result.candidates.length} 项`)

console.log('OK')
console.log('  tools:', toolNames.join(', '))
console.log('  routes:', paths.join(', '))
console.log('  report:', `${value.totals.sessions} sessions / ${value.totals.items} items / ${value.totals.size}`, `(${((Date.now() - started) / 1000).toFixed(1)}s)`)
if (sample) console.log('  sample item:', JSON.stringify({ name: sample.name, size: sample.size, path: sample.path, purpose: sample.purpose }).slice(0, 220))
console.log('  baselineAuto:', value.baselineAuto ?? '(已是最新)', '| baseline:', value.baselineTakenAt ? new Date(value.baselineTakenAt).toLocaleString('sv-SE') : '无')
console.log('  procs:', `${procsBody.result.value.processes} 进程 / 历史采样 ${procsBody.result.value.totalSamples} 次 / 因果表 ${procsBody.result.value.causal.length} 行`)
console.log('  clean preview:', `确认=${cleaned.confirm} 白名单内=${cleaned.items.filter((i) => i.ok).length} 拒绝=${cleaned.items.filter((i) => !i.ok).length}`)
console.log('  history:', `${profile.total} 个遗留目录 / 对上 ${profile.sessions.length} 个会话 / 对不上 ${profile.unmatched.count} 个`)
if (profile.sessions[0]) console.log('    最可能:', `${profile.sessions[0].count}× ${profile.sessions[0].title}`)
console.log('  repro:', `${repro.commands} 条命令 / 候选脚本 ${repro.candidates.length} 个${repro.candidates[0] ? ` / 第一候选 ${repro.candidates[0].path}` : ''}`)
