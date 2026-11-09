/**
 * 命令解析层：从一条 shell 命令里认出「这一步在装什么」。
 * 只做模式识别，不执行任何东西。
 */

/** 一行里可能有多段命令，先粗切再匹配 */
function segments(command) {
  return command
    .split(/\r?\n|;|&&|\|\|/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const NAME_STOP = /^(-{1,2}|[<>|&])/

/** 从参数串里挑出包名（去掉 flag、版本约束、路径、URL） */
function pickNames(rest) {
  const names = []
  for (const token of rest.split(/\s+/)) {
    if (!token) continue
    if (NAME_STOP.test(token)) {
      // 带值的 flag 后面那个 token 不是包名
      continue
    }
    if (/^[A-Za-z]:[\\/]/.test(token)) continue // 绝对路径
    if (/^[./\\]/.test(token)) continue // 相对路径
    if (/^https?:\/\//i.test(token)) continue
    if (/^['"]/.test(token)) continue
    const name = token
      .replace(/\[.*?\]$/, '') // extras
      .replace(/[@=<>!~].*$/, '') // 版本约束
      .trim()
    if (name.length === 0 || name.length > 80) continue
    if (/^[\d.]+$/.test(name)) continue
    names.push(name)
  }
  return names
}

function dirFromUrl(url) {
  const cleaned = url.replace(/\.git$/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  const last = cleaned.split(/[\\/]/).pop() || ''
  return last
}

const RULES = [
  {
    eco: 'python',
    test: /^(?:sudo\s+)?(?:py|python[0-9.]*|pip[0-9.]*)\s+(?:-\S+\s+)*install\s+(.*)$/i,
    build: (m) => ({ eco: 'python', action: 'pip install', names: pickNames(m[1]) }),
  },
  {
    eco: 'python',
    test: /^(?:sudo\s+)?(?:py|python[0-9.]*)\s+-m\s+pip\s+install\s+(.*)$/i,
    build: (m) => ({ eco: 'python', action: 'pip install', names: pickNames(m[1]) }),
  },
  {
    eco: 'python',
    test: /^(?:sudo\s+)?uv\s+(?:pip\s+)?(?:add|install)\s+(.*)$/i,
    build: (m) => ({ eco: 'python', action: 'uv add', names: pickNames(m[1]) }),
  },
  {
    eco: 'python-env',
    test: /^(?:py|python[0-9.]*)\s+-m\s+venv\s+(\S+)/i,
    build: (m) => ({ eco: 'python-env', action: '建 venv', names: [], outPath: m[1].replace(/^['"]|['"]$/g, '') }),
  },
  {
    eco: 'conda',
    test: /^conda\s+create\b(.*)$/i,
    build: (m) => {
      const env = /(?:-n|--name)\s+(\S+)/.exec(m[1])
      const prefix = /(?:-p|--prefix)\s+(\S+)/.exec(m[1])
      return { eco: 'conda', action: 'conda create', names: env ? [env[1]] : [], outPath: prefix ? prefix[1] : undefined }
    },
  },
  {
    eco: 'node',
    test: /^(?:sudo\s+)?npm\s+(?:i|install|add)\s+(.*)$/i,
    build: (m) => ({ eco: 'node', action: 'npm install', names: pickNames(m[1]) }),
  },
  {
    eco: 'node',
    test: /^(?:sudo\s+)?(?:pnpm|yarn|bun)\s+(?:add|i|install|global\s+add)\s+(.*)$/i,
    build: (m) => ({ eco: 'node', action: 'pnpm/yarn add', names: pickNames(m[1]) }),
  },
  {
    eco: 'git',
    test: /^git\s+clone\s+(.*)$/i,
    build: (m) => {
      const url = (m[1].match(/https?:\/\/\S+|git@\S+|[\w.-]+\/[\w.-]+\.git/) || [''])[0]
      const rest = m[1].replace(url, '').trim()
      // --depth 1 / -b main 这类带值参数后面跟的是值，不是目标目录
      const valueFlags = new Set(['--depth', '-b', '--branch', '-o', '--origin', '-c', '--config', '-j', '--jobs', '--filter', '--reference', '--template', '--separate-git-dir', '--shallow-since', '--shallow-exclude'])
      const tokens = rest.split(/\s+/).filter(Boolean)
      let target
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (/^\d>&\d$/.test(token)) continue
        if (valueFlags.has(token)) {
          i++ // 跳过它的值
          continue
        }
        if (token.startsWith('-')) continue
        target = token
        break
      }
      return { eco: 'git', action: 'git clone', names: url ? [dirFromUrl(url)] : [], url, outPath: target }
    },
  },
  {
    eco: 'winget',
    test: /^winget\s+install\s+(.*)$/i,
    build: (m) => {
      const id = /(?:--id|-i)\s+(\S+)/.exec(m[1])
      return { eco: 'winget', action: 'winget install', names: id ? [id[1].replace(/["']/g, '')] : pickNames(m[1]) }
    },
  },
  {
    eco: 'choco',
    test: /^(?:choco|scoop)\s+install\s+(.*)$/i,
    build: (m) => ({ eco: 'choco', action: 'choco/scoop install', names: pickNames(m[1]) }),
  },
  {
    eco: 'cargo',
    test: /^cargo\s+install\s+(.*)$/i,
    build: (m) => ({ eco: 'cargo', action: 'cargo install', names: pickNames(m[1]) }),
  },
  {
    eco: 'go',
    test: /^go\s+install\s+(.*)$/i,
    build: (m) => ({ eco: 'go', action: 'go install', names: [m[1].trim().split(/\s+/)[0]] }),
  },
  {
    eco: 'docker',
    test: /^docker\s+pull\s+(.*)$/i,
    build: (m) => ({ eco: 'docker', action: 'docker pull', names: pickNames(m[1]) }),
  },
  {
    eco: 'model',
    test: /^(?:huggingface-cli|hf)\s+download\s+(.*)$/i,
    build: (m) => ({ eco: 'model', action: '模型下载', names: pickNames(m[1]) }),
  },
  {
    eco: 'download',
    test: /(?:Invoke-WebRequest|curl|iwr|wget)\b.*?(?:-OutFile|-o)\s+(\S+)/i,
    build: (m) => ({ eco: 'download', action: '下载文件', names: [], outPath: m[1].replace(/^['"]|['"]$/g, ''), download: true }),
  },
  {
    eco: 'download',
    test: /(?:Start-BitsTransfer|bitsadmin)\b.*?-Destination\s+(\S+)/i,
    build: (m) => ({ eco: 'download', action: '下载文件', names: [], outPath: m[1].replace(/^['"]|['"]$/g, ''), download: true }),
  },
  {
    eco: 'remote-script',
    whole: true,
    test: /\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|curl)\b[^|]*\|\s*(?:iex|Invoke-Expression|sh|bash|powershell|pwsh)\b/i,
    build: () => ({ eco: 'remote-script', action: '远程脚本安装', names: [], risky: true }),
  },
  {
    eco: 'installer',
    test: /^(?:\.\/|(?:[A-Za-z]:)?[\\/])?\S+\.(?:exe|msi)\b.*?(?:\/S|\/silent|--silent|--quiet|-q|\/quiet)/i,
    build: (m) => {
      const file = (m[0].match(/[^\s"'|;&]+\.(?:exe|msi)/i) || [''])[0]
      return { eco: 'installer', action: '静默安装器', names: [file.split(/[\\/]/).pop() || ''].filter(Boolean) }
    },
  },
]

/**
 * @param {string} command 一条 shell 命令（可能多行）
 * @returns {Array<object>} 安装事件
 */
/** 从一段命令里抽出「切到了哪个目录」，用于定位 git clone / npm install 的落点 */
function dirHintIn(segment) {
  const patterns = [
    /\bcd\s+(?:chdir\s+)?["']?([A-Za-z]:[^"'|;&]+)/i,
    /New-Item\s+-ItemType\s+Directory[^;|]*?["']([A-Za-z]:[^"']+)["']/i,
    /\bmkdir\s+["']?([A-Za-z]:[^"'|;&]+)/i,
    /\bPush-Location\s+["']?([A-Za-z]:[^"'|;&]+)/i,
  ]
  for (const pattern of patterns) {
    const m = pattern.exec(segment)
    if (m) return m[1].trim().replace(/["']$/, '')
  }
  return ''
}

export function extractInstalls(command) {
  if (typeof command !== 'string' || command.length === 0) return []
  const found = []
  let runningHint = ''
  for (const segment of segments(command)) {
    const hint = dirHintIn(segment)
    if (hint) runningHint = hint
    // 管道后面是后处理（Select-Object / Format-List …），不是安装的一部分
    const bare = segment.split('|')[0].trim()
    for (const rule of RULES) {
      const subject = rule.whole ? segment : bare
      const m = rule.test.exec(subject)
      if (!m) continue
      const event = rule.build(m)
      if (!event) continue
      const names = (event.names || []).filter((n) => typeof n === 'string' && n.length > 0)
      if (names.length === 0 && !event.outPath && !event.risky) continue
      found.push({ ...event, names, segment: bare, cwdHint: runningHint || undefined, eco: event.eco || rule.eco })
      break
    }
  }
  return found
}

/** 判断一条命令是否可能改变「本机装了哪些东西」（用于快速筛会话日志） */
export function looksLikeInstall(command) {
  if (typeof command !== 'string') return false
  return /pip[0-9.]*\s+install|pip\s+install|npm\s+(?:i|install|add)|pnpm\s+add|yarn\s+add|git\s+clone|winget\s+install|choco\s+install|scoop\s+install|cargo\s+install|go\s+install|conda\s+create|python[0-9.]*\s+-m\s+venv|docker\s+pull|huggingface-cli\s+download|-OutFile|bitsadmin/i.test(
    command,
  )
}
