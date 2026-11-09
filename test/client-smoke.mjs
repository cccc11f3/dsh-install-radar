/**
 * 客户端半部分的冒烟测试：不开浏览器，只验证
 *   - window.__ModuleLoader__ 的 factory 能跑通
 *   - apply() 真的注册了 sidebar.panellist（id=install-radar）和 main（key=install-radar）
 *   - 组件函数能构造出元素树（不渲染，只调用一次）
 * 用法：node test/client-smoke.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

let loaded
const registrations = []
let elementCalls = 0

const fakeReact = {
  createElement: (type, props, ...children) => {
    elementCalls++
    return { type, props: props || {}, children }
  },
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
}

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, exports: factory(() => fakeReact) }
    },
  },
}

// eslint-disable-next-line no-new-func
new Function(source)()

if (!loaded) throw new Error('client bundle never called __ModuleLoader__.load')
const mod = loaded.exports
if (typeof mod.apply !== 'function') throw new Error('client exports.apply missing')

const rpcCalls = []
const ctx = {
  get: () => ({
    rpc: {
      call: async (channel, endpoint) => {
        rpcCalls.push(`${channel}:${endpoint}`)
        return { ok: true, value: { totals: { sessions: 0, items: 0, size: '0 B' }, perSession: [], unattributed: [] } }
      },
    },
  }),
  slots: {
    inject: (_name, fn) => fn(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  effect: (fn) => fn(),
  locale: { register: () => () => {}, subscribe: () => () => {} },
  get: (name) => (name === 'connection' ? { rpc: { call: async (channel, endpoint) => (rpcCalls.push(`${channel}:${endpoint}`), { ok: true, value: { totals: { sessions: 0, items: 0, size: '0 B' }, perSession: [], unattributed: [] } }) } } : undefined),
}

mod.apply(ctx)

const panelEntry = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
const mainEntry = registrations.find((entry) => entry.options.name === 'main')
if (!panelEntry) throw new Error('sidebar.panellist was not registered')
if (!mainEntry) throw new Error('main was not registered')
if (panelEntry.options.id !== 'install-radar') throw new Error(`unexpected panel id: ${panelEntry.options.id}`)
if (mainEntry.options.key !== 'install-radar') throw new Error(`unexpected main key: ${mainEntry.options.key}`)
if (panelEntry.options.order !== -20) throw new Error(`unexpected order: ${panelEntry.options.order}`)

// 组件能构造：图标 + 面板
const glyph = panelEntry.component({ size: 16, active: true })
if (!glyph) throw new Error('glyph component returned nothing')
const injected = mainEntry.options.inject ? mainEntry.options.inject() : {}
const panel = mainEntry.component({ ...injected })
if (!panel) throw new Error('panel component returned nothing')

const sampleSession = {
  id: 'session-test',
  title: '测试会话',
  cwd: 'E:\\DeepSeek Harness工作区',
  size: '1.2 GB',
  items: [
    {
      name: 'ComfyUI',
      eco: 'git',
      size: '1.2 GB',
      path: 'E:\\ComfyUI',
      purpose: 'ComfyUI：节点式 Stable Diffusion 工作流',
      confidence: 'high',
      command: 'git clone https://github.com/comfyanonymous/ComfyUI',
      birthtime: Date.now(),
      uninstall: 'Remove-Item -LiteralPath "E:\\ComfyUI" -Recurse -Force',
    },
    { name: 'torch', eco: 'python', size: '2.4 GB', path: '', purpose: 'PyTorch 运行时', confidence: 'none', note: '未在本机找到对应产物' },
    { name: 'blender', eco: 'winget', size: '300 MB', path: 'C:\\Program Files\\Blender Foundation', purpose: '3D 建模', confidence: 'low' },
  ],
}
const block = mod.__internals.SessionBlock({ session: sampleSession, defaultOpen: true })
if (!block) throw new Error('SessionBlock returned nothing')
const flat = JSON.stringify(block)
if (flat.includes('ComfyUI')) throw new Error('SessionBlock must be collapsed by default')
if (!flat.includes('测试会话')) throw new Error('SessionBlock did not render its title')

const panelWithData = mainEntry.component({ ...injected, __forceData: true })
if (!panelWithData) throw new Error('panel component returned nothing')

// v0.3：分组卡片 + 卸载命令按钮
const group = { key: 'git', title: '代码仓库', size: '1.2 GB', items: sampleSession.items }
const groupTree = JSON.stringify(mod.__internals.ItemGroup({ group, defaultOpen: true }))
if (!groupTree.includes('代码仓库')) throw new Error('ItemGroup did not render its title')
const itemTree = JSON.stringify(mod.__internals.Item({ item: sampleSession.items[0] }))
if (!itemTree.includes('卸载命令')) throw new Error('Item did not render the uninstall chip')
if (!itemTree.includes('Remove-Item')) throw new Error('uninstall command not rendered')

// v0.5：非会话新增（时间戳扫描）+ 二段式清理 + 进程审计行
const recentItem = {
  path: 'C:\\WINDOWS\\Temp\\cdp-seq*',
  size: '7.6 GB',
  bytes: 8.1e9,
  files: 12345,
  label: '系统临时目录',
  purpose: '浏览器自动化（CDP）的临时 profile 目录，可整目录删',
  samples: ['C:\\WINDOWS\\Temp\\cdp-seq-9401'],
}
const askTree = JSON.stringify(mod.__internals.RecentRow({ item: recentItem, rpc: null, onAsk: () => {} }))
if (!askTree.includes('清理')) throw new Error('RecentRow did not render the clean button')
const pendingTree = JSON.stringify(
  mod.__internals.RecentRow({ item: recentItem, rpc: null, pending: true, onAsk: () => {}, onConfirm: () => {}, onCancel: () => {} }),
)
if (!pendingTree.includes('确认删除？')) throw new Error('RecentRow did not render the confirm step')

// v0.6：后果标注 + 50MB 门槛 + 历史侧写 + 因果表
const risky = JSON.stringify(
  mod.__internals.RecentRow({
    item: { ...recentItem, risk: 'safe', consequence: '无影响：浏览器自动化每次都会新建 profile', cleanable: true },
    rpc: null,
    onAsk: () => {},
  }),
)
if (!risky.includes('无影响')) throw new Error('RecentRow did not render the consequence note')
const tooSmall = JSON.stringify(
  mod.__internals.RecentRow({ item: { ...recentItem, bytes: 1024, size: '1 KB', cleanable: false }, rpc: null, onAsk: () => {} }),
)
if (tooSmall.includes('"dsh-ir-chip dsh-ir-chip--danger"')) throw new Error('clean button must be hidden below 50 MB')
const histTree = JSON.stringify(
  mod.__internals.HistoryRow({
    row: { sessionId: 's1', title: '复制3D3并替换打印机形象', count: 298, high: 157, bytes: 1.8e10, firstAt: 1794000000000, lastAt: 1794100000000, samples: ['chrome.exe --user-data-dir=...'] },
  }),
)
if (!histTree.includes('高概率')) throw new Error('HistoryRow did not render the probability verdict')
const causalTree = JSON.stringify(
  mod.__internals.CausalRow({
    row: { launcher: 'node.exe (pid 1234)', label: 'CDP 调试端口', count: 42, paths: ['C:\\Windows\\Temp\\cdp-seq-1'], disk: [{ path: 'C:\\Windows\\Temp\\cdp-seq*', size: '7.6 GB' }], parentCommand: 'node driver.js' },
  }),
)
if (!causalTree.includes('7.6 GB')) throw new Error('CausalRow did not join disk usage')

// v0.7：会话条目的卸载后果 + 复现线索行
const sessionItemTree = JSON.stringify(
  mod.__internals.Item({
    item: {
      name: 'Hunyuan3D-2',
      eco: 'git',
      size: '17.7 GB',
      path: 'E:\\3DAI',
      purpose: '文/图生 3D 模型生成工具',
      confidence: 'low',
      uninstall: 'Remove-Item -LiteralPath "E:\\3DAI" -Recurse -Force',
      uninstallRisk: { level: 'danger', consequence: '整个目录会被删掉：源码与模型一起消失' },
    },
    rpc: null,
  }),
)
if (!sessionItemTree.includes('卸载后果')) throw new Error('Item did not render the uninstall consequence')
const reproTree = JSON.stringify(
  mod.__internals.ReproRow({
    row: {
      path: 'E:\\大肥鱼\\tools\\eval.mjs',
      usedInCommands: 85,
      verdict: '脚本里没有清理逻辑 —— 临时 profile 只进不出',
      cdpLines: ["'--user-data-dir=C:\\\\Windows\\\\Temp\\\\cdp-eval-'"],
      hook: 'const cleanup = () => { fs.rmSync(profileDir) }',
    },
  }),
)
if (!reproTree.includes('eval.mjs')) throw new Error('ReproRow did not render the script path')
if (!reproTree.includes('没有清理逻辑')) throw new Error('ReproRow did not render the verdict')

// v0.8：三色 emoji + 多选
const riskSafe = JSON.stringify(mod.__internals.RiskNote({ level: 'safe', text: '无影响' }))
const riskWarn = JSON.stringify(mod.__internals.RiskNote({ level: 'caution', text: '需注意' }))
const riskDanger = JSON.stringify(mod.__internals.RiskNote({ level: 'danger', text: '不要删' }))
if (!riskSafe.includes('🟢')) throw new Error('safe risk missing 🟢')
if (!riskWarn.includes('🟡')) throw new Error('caution risk missing 🟡')
if (!riskDanger.includes('🔴')) throw new Error('danger risk missing 🔴')

const pickTree = JSON.stringify(
  mod.__internals.RecentRow({ item: { ...recentItem, cleanable: true }, rpc: null, selected: true, onToggle: () => {}, onAsk: () => {} }),
)
if (!pickTree.includes('"type":"checkbox"')) throw new Error('RecentRow did not render the checkbox')
if (!pickTree.includes('dsh-ir-recent--picked')) throw new Error('selected row missing highlight')
const lockedTree = JSON.stringify(
  mod.__internals.RecentRow({ item: { ...recentItem, cleanable: false }, rpc: null, onToggle: () => {}, onAsk: () => {} }),
)
if (lockedTree.includes('"type":"checkbox"')) throw new Error('non-cleanable row must not be selectable')
if (!lockedTree.includes('🔴')) throw new Error('non-cleanable row missing 🔴 marker')

// v0.9：趋势柱状图 + 自动清理开关
const trendTree = JSON.stringify(
  mod.__internals.TrendBars({
    trend: {
      days: 14,
      totalBytes: 3e9,
      maxBytes: 1.5e9,
      buckets: [
        { day: '2026-11-08', bytes: 1.5e9, files: 10 },
        { day: '2026-11-09', bytes: 1.5e9, files: 5 },
      ],
    },
  }),
)
if (!trendTree.includes('dsh-ir-bars')) throw new Error('TrendBars missing bars')
if (!trendTree.includes('11-08')) throw new Error('TrendBars missing day labels')

const autoTree = JSON.stringify(mod.__internals.AutoCleanRow({ autoClean: { enabled: false, minAgeDays: 7 }, onChange: () => {} }))
if (!autoTree.includes('定时自动清理')) throw new Error('AutoCleanRow missing label')
if (!autoTree.includes('"type":"select"')) throw new Error('AutoCleanRow missing day selector')
const autoOn = JSON.stringify(mod.__internals.AutoCleanRow({ autoClean: { enabled: true, minAgeDays: 14 }, onChange: () => {} }))
if (!autoOn.includes('🟢')) throw new Error('AutoCleanRow missing enabled state')

// v0.10：选择栏吸附（sticky）+ 确认态
const barTree = JSON.stringify(
  mod.__internals.SelBar({
    cleanableCount: 12,
    totalCount: 60,
    safeCount: 9,
    selectedCount: 3,
    selectedSize: '5.4 GB',
    busy: false,
    pending: false,
    onSelectSafe: () => {},
    onSelectAll: () => {},
    onClear: () => {},
    onDelete: () => {},
  }),
)
if (!barTree.includes('dsh-ir-selbarWrap')) throw new Error('SelBar missing sticky wrapper class')
if (!barTree.includes('只选安全 9')) throw new Error('SelBar missing safe-only selection')
if (!barTree.includes('全选（含需注意） 12')) throw new Error('SelBar missing select-all-with-caution')
if (!barTree.includes('删除选中 3')) throw new Error('SelBar missing selection count')
const barPending = JSON.stringify(
  mod.__internals.SelBar({
    cleanableCount: 12,
    totalCount: 60,
    safeCount: 9,
    selectedCount: 3,
    selectedSize: '5.4 GB',
    busy: false,
    pending: true,
    onConfirm: () => {},
    onCancel: () => {},
  }),
)
if (!barPending.includes('--confirm')) throw new Error('SelBar missing confirm styling')
if (!barPending.includes('确认删除以下')) throw new Error('SelBar missing confirm text')

// v0.11：清理后原地摘除（不重新拉取）
const before = {
  items: [
    { path: 'C:\\Windows\\Temp\\cdp-seq*', bytes: 8e9, files: 100, size: '7.5 GB' },
    { path: 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-ch-probe', bytes: 2e8, files: 10, size: '190 MB' },
    { path: 'C:\\Users\\x\\Desktop\\setup.exe', bytes: 3e8, files: 1, size: '286 MB' },
  ],
  totalBytes: 8e9 + 2e8 + 3e8,
  totalFiles: 111,
  sinceLabel: '2026-11-06 13:00:00',
}
const after = mod.__internals.filterCleaned(before, {
  items: [
    { path: 'C:\\Windows\\Temp\\cdp-seq-9401', ok: true, bytes: 4e9 },
    { path: 'C:\\Windows\\Temp\\cdp-seq-9402', ok: true, bytes: 4e9 },
    { path: 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-ch-probe', ok: false, reason: '被占用' },
  ],
})
if (after.recent.items.length !== 2) throw new Error(`expected 2 rows left, got ${after.recent.items.length}`)
if (after.recent.items.some((item) => item.path.includes('cdp-seq*'))) throw new Error('wildcard row should be removed')
if (!after.recent.items.some((item) => item.path.includes('dsh-ch-probe'))) throw new Error('failed clean must keep the row')
if (after.recent.totalBytes !== 5e8) throw new Error(`totals not adjusted: ${after.recent.totalBytes}`)
if (!after.removed.some((path) => path.includes('cdp-seq*'))) throw new Error('removed list missing the wildcard row')

// v0.12：条目卡片交替底色 + 「为什么装」
const cardA = JSON.stringify(mod.__internals.Item({ item: sampleSession.items[0], rpc: null, index: 0 }))
const cardB = JSON.stringify(mod.__internals.Item({ item: sampleSession.items[1], rpc: null, index: 1 }))
if (!cardA.includes('dsh-ir-itemCard')) throw new Error('Item missing card wrapper')
if (cardA.includes('--alt')) throw new Error('first card must not be the alt variant')
if (!cardB.includes('dsh-ir-itemCard--alt')) throw new Error('second card missing alt variant')
const withWhy = JSON.stringify(
  mod.__internals.Item({
    item: { ...sampleSession.items[0], why: { kind: 'agent-note', text: '安装并验证腾讯云 ai3d SDK' } },
    rpc: null,
    index: 0,
  }),
)
if (!withWhy.includes('为什么装')) throw new Error('Item missing why line')
if (!withWhy.includes('腾讯云 ai3d SDK')) throw new Error('why text missing')

console.log('OK')
console.log('  inject:', JSON.stringify(mod.inject))
console.log('  registrations:', registrations.map((entry) => `${entry.options.name}(${entry.options.id ?? entry.options.key}) order=${entry.options.order ?? '-'}`).join(', '))
console.log('  createElement calls:', elementCalls)
console.log('  rpc so far:', rpcCalls.length === 0 ? '(none until mount)' : rpcCalls.join(', '))
