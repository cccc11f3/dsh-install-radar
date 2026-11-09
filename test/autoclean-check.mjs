/**
 * 自动清理自测（全沙箱，不碰真实临时目录）：
 *   1. 预览能命中「够老 + 够大 + safe」的项
 *   2. 真删能删掉它
 *   3. 不够大的不删
 *   4. 不在白名单里的一律不删
 * 用法：node test/autoclean-check.mjs
 */
import { mkdir, writeFile, truncate, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { autoCleanSweep } from '../src/engine/autoclean.js'

// 目录名要长得像真实临时目录（...\Temp\cdp-xxx），否则 safe 判定不会命中
const outer = join(process.env.TEMP || process.env.TMP || '.', '__radar_autoclean_sandbox__')
const sandboxRoot = join(outer, 'Temp')
await rm(outer, { recursive: true, force: true })
await mkdir(sandboxRoot, { recursive: true })

const bigDir = join(sandboxRoot, 'cdp-autotest-big')
const smallDir = join(sandboxRoot, 'cdp-autotest-small')
const dangerDir = join(sandboxRoot, '.pnpm-store')
const future = Date.now() + 8 * 86400_000

await mkdir(bigDir, { recursive: true })
const bigFile = join(bigDir, 'profile.bin')
await writeFile(bigFile, '')
await truncate(bigFile, 60 * 1024 * 1024)

await mkdir(smallDir, { recursive: true })
await writeFile(join(smallDir, 'tiny.txt'), 'x'.repeat(1024))

await mkdir(dangerDir, { recursive: true })
const dangerFile = join(dangerDir, 'store.bin')
await writeFile(dangerFile, '')
await truncate(dangerFile, 60 * 1024 * 1024)

const opts = { home: sandboxRoot, minAgeDays: 7, now: future, roots: [sandboxRoot] }
const preview = await autoCleanSweep({ ...opts, dryRun: true })
const paths = preview.candidates.map((item) => item.path.toLowerCase())
if (!paths.includes(bigDir.toLowerCase())) throw new Error('preview missed the aged 60 MB cdp-* dir')
if (paths.includes(smallDir.toLowerCase())) throw new Error('preview must skip items below 50 MB')
if (paths.includes(dangerDir.toLowerCase())) throw new Error('preview must skip danger items (.pnpm-store)')

const real = await autoCleanSweep({ ...opts, dryRun: false })
if (real.removed !== 1) throw new Error(`expected exactly 1 removal, got ${real.removed}`)
if (existsSync(bigDir)) throw new Error('aged cdp-* dir still exists')
if (!existsSync(smallDir)) throw new Error('small dir must survive')
if (!existsSync(dangerDir)) throw new Error('danger dir must survive')

await rm(sandboxRoot, { recursive: true, force: true })

console.log('OK')
console.log(`  沙箱扫描 ${preview.scanned} 项 · 命中 ${preview.candidates.length} 项 · 删除 ${real.removed} 项 · 释放 ${(real.freed / 1024 ** 2).toFixed(0)} MB`)
