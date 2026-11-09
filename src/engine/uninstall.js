/**
 * 卸载指引：按生态给出「怎么把它弄掉」的命令。
 * 只生成命令字符串，永远不执行 —— 复制到剪贴板由用户自己决定跑不跑。
 */

const quote = (value) => `"${String(value).replace(/"/g, '')}"`

export function suggestUninstall(item) {
  const eco = item.eco || ''
  const name = item.name || ''
  const path = item.path || ''

  if (!name) return ''
  if (eco === 'python') return `python -m pip uninstall -y ${name}`
  if (eco === 'node') {
    if (path && /[\\/]node_modules[\\/]/i.test(path)) {
      const project = path.split(/[\\/]node_modules[\\/]/i)[0]
      return `cd ${quote(project)} ; npm rm ${name}`
    }
    return `npm rm -g ${name}`
  }
  if (eco === 'winget') return `winget uninstall ${name}`
  if (eco === 'choco') return `choco uninstall ${name}`
  if (eco === 'conda') return `conda env remove -n ${name}`
  if (eco === 'python-env') return path ? `Remove-Item -LiteralPath ${quote(path)} -Recurse -Force` : ''
  if (eco === 'git' || eco === 'download' || eco === 'installer') {
    return path ? `Remove-Item -LiteralPath ${quote(path)} -Recurse -Force` : ''
  }
  return path ? `Remove-Item -LiteralPath ${quote(path)} -Recurse -Force` : ''
}
