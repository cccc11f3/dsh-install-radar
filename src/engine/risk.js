/**
 * 后果评估：删了这个东西会怎样。
 * 只做判断，不做删除；面板上每一行都带这个结论，确认框里也再写一次。
 *
 * 三档：
 *   safe     —— 删了没影响，或下次会自动重建
 *   caution  —— 可能影响正在运行的程序 / 下次要重新下载
 *   danger   —— 会破坏已装东西或丢数据，面板不提供一键删
 */
const RULES = [
  {
    test: /[\\/]Temp[\\/]cdp-[^\\/]+$/i,
    level: 'safe',
    consequence: '无影响：浏览器自动化每次都会新建 profile，下次运行会重建',
  },
  {
    test: /[\\/]Temp[\\/](HeadlessChrome|pip-unpack-|scoped_dir|chrome_|chrome-shot-|chrome-profile-)[^\\/]*$/i,
    level: 'safe',
    consequence: '无影响：临时解包/无头浏览器目录，进程退出后本来也该被清掉',
  },
  {
    test: /[\\/]\.pnpm-store$/i,
    level: 'danger',
    consequence: '会破坏已装依赖：pnpm 的硬链接源，删了现有 node_modules 变成断链，必须重新 install',
  },
  {
    test: /[\\/]\.cache[\\/]huggingface|[\\/]huggingface[\\/]hub/i,
    level: 'caution',
    consequence: '要重新下载模型：下次用到会重新拉几十 GB 权重，网络差时很久',
  },
  {
    test: /[\\/]pip[\\/]cache|[\\/]\.cache[\\/]pip/i,
    level: 'caution',
    consequence: '要重新下载包：下次 pip install 会从网上重新拉，不影响已装好的',
  },
  {
    test: /[\\/]Windows[\\/]Installer$/i,
    level: 'danger',
    consequence: '会影响卸载与修复：MSI 缓存删了以后程序无法「更改/修复」，卸载可能留下残骸',
  },
  {
    test: /[\\/]Temp$/i,
    level: 'caution',
    consequence: '可能影响正在运行的程序：正在安装/下载的会中断，建议先关掉相关程序再清',
  },
  {
    test: /\.(exe|msi|zip|7z|rar)$/i,
    level: 'safe',
    consequence: '只是安装包/压缩包：装完或解压完就没用了，除非还要留着重装',
  },
  {
    test: /[\\/](site-packages|dist-packages|node_modules)[\\/]/i,
    level: 'danger',
    consequence: '会破坏已装依赖：删掉后对应程序/项目直接跑不起来',
  },
  {
    test: /[\\/]User Data([\\/]|$)|[\\/]Default[\\/](History|Bookmarks|Login Data)$/i,
    level: 'danger',
    consequence: '会丢浏览器数据：登录状态、历史、书签都在里面',
  },
  {
    test: /[\\/]\.ollama[\\/]models/i,
    level: 'caution',
    consequence: '要重新下载模型：本地大模型权重，重下很慢',
  },
  {
    test: /[\\/]\$Recycle\.Bin/i,
    level: 'caution',
    consequence: '回收站里的东西就真的没了：里面还有你手动删的文件',
  },
]

/** 临时目录根本身：不能整根一键清（服务端也会拒），UI 里不给勾选框 */
function isTempRoot(path) {
  const p = String(path || '').replace(/[\\/]+$/, '').toLowerCase()
  if (!p) return false
  const roots = []
  if (process.platform === 'win32') {
    roots.push(`${String(process.env.SystemRoot || 'C:\\Windows').toLowerCase()}\\temp`)
    roots.push(`${String(process.env.LOCALAPPDATA || `${process.env.USERPROFILE}\\AppData\\Local`).toLowerCase()}\\temp`)
    roots.push('c:\\temp')
  }
  const tmp = String(process.env.TMP || process.env.TEMP || '').replace(/[\\/]+$/, '').toLowerCase()
  if (tmp) roots.push(tmp)
  return roots.includes(p)
}

/**
 * @param {string} target 路径
 * @param {{bytes?:number}} info
 * @returns {{level:'safe'|'caution'|'danger', consequence:string, isRoot?:boolean}}
 */
export function assessRisk(target, info = {}) {
  // 归一化重复分隔符，避免 C:\\Windows\\Temp 这种写法绕过规则
  const path = String(target || '').replace(/([\\/])[\\/]+/g, '$1')
  if (isTempRoot(path)) {
    return {
      level: 'caution',
      consequence: '这是临时目录根，不能整根一键清：要清请勾选里面的子目录（整根清会把正在运行的程序一起拖下水）',
      isRoot: true,
    }
  }
  for (const rule of RULES) {
    if (rule.test.test(path)) return { level: rule.level, consequence: rule.consequence }
  }
  const bytes = Number(info.bytes) || 0
  if (bytes > 5 * 1024 ** 3) {
    return { level: 'caution', consequence: '体积很大（>5 GB）：删前确认这不是你要留的项目/模型目录' }
  }
  return { level: 'caution', consequence: '不确定用途：删前打开目录看一眼，别把还在用的东西删了' }
}

/** 面板用：clean 按钮是否出现（低于 50 MB 不给按钮，避免误删正在用的临时文件） */
export const CLEAN_MIN_BYTES = 50 * 1024 * 1024

/**
 * 卸载后果：对「会话装进来的东西」，卸掉会怎样。
 * 与清理后果不同——这里说的是功能层影响，不是磁盘风险。
 * @param {{eco?:string, name?:string, path?:string}} item
 * @returns {{level:'safe'|'caution'|'danger', consequence:string}}
 */
export function assessUninstall(item = {}) {
  const eco = String(item.eco || '')
  const name = String(item.name || '')
  const path = String(item.path || '')

  if (eco === 'python') {
    return {
      level: 'caution',
      consequence: `卸掉后依赖 ${name} 的脚本会 ImportError；用 pip 重装即可恢复（已装的其它包不受影响）`,
    }
  }
  if (eco === 'node') {
    if (/[\\/]node_modules[\\/]/i.test(path)) {
      return {
        level: 'danger',
        consequence: `会破坏该项目：项目里 import ${name} 的代码会直接跑不起来，要重新 npm install 才恢复`,
      }
    }
    return { level: 'caution', consequence: `全局命令 ${name} 会消失；重新 npm i -g 可恢复` }
  }
  if (eco === 'git') {
    return {
      level: 'danger',
      consequence: `整个目录会被删掉：${name} 的源码与里面装好的依赖/模型全部消失，只能重新 clone（有本地改动也会丢）`,
    }
  }
  if (eco === 'winget' || eco === 'choco') {
    return {
      level: 'caution',
      consequence: `程序 ${name} 会被卸载，桌面/开始菜单快捷方式失效；配置一般保留在 AppData`,
    }
  }
  if (eco === 'python-env' || eco === 'conda') {
    return { level: 'danger', consequence: `整个运行环境会被删除：该环境里装的所有包一起消失` }
  }
  if (eco === 'download' || eco === 'installer') {
    return { level: 'safe', consequence: '删的只是安装包/下载文件，已装好的程序不受影响' }
  }
  if (path) {
    return { level: 'caution', consequence: '删除该路径会移除对应文件；删前确认没有程序还在用它' }
  }
  return { level: 'caution', consequence: '未找到落盘产物，无法判断卸载影响' }
}
