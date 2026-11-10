#!/usr/bin/env node
/**
 * 给审计日志脱敏：把 ghp_/npm_/sk-/Bearer/_authToken/--otp 一类密钥片段就地打码。
 *
 * 用法：
 *   node tools/redact-logs.mjs <文件> [文件…]
 *   node tools/redact-logs.mjs --dry <文件>      # 只统计会被改多少行
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const redact = (text) =>
  String(text)
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}\b/g, '$1_[REDACTED]')
    .replace(/\bnpm_[A-Za-z0-9]{8,}\b/g, 'npm_[REDACTED]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, '$1-[REDACTED]')
    .replace(/(_authToken=|_auth=|--otp=|token=)([^\s"'&]+)/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 [REDACTED]')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const files = args.filter((arg) => arg !== '--dry')
if (files.length === 0) {
  console.error('用法：node tools/redact-logs.mjs [--dry] <文件> [文件…]')
  process.exit(1)
}

for (const file of files) {
  const before = readFileSync(file, 'utf8')
  const lines = before.split('\n')
  let changed = 0
  const after = lines
    .map((line) => {
      const next = redact(line)
      if (next !== line) changed++
      return next
    })
    .join('\n')
  if (dry) {
    console.log(`${file}: ${lines.length} 行，其中 ${changed} 行含密钥片段（dry-run 未写入）`)
    continue
  }
  if (changed === 0) {
    console.log(`${file}: 无需脱敏`)
    continue
  }
  copyFileSync(file, `${file}.bak`)
  writeFileSync(file, after, 'utf8')
  console.log(`${file}: 已脱敏 ${changed} 行（备份 ${file}.bak）`)
}
