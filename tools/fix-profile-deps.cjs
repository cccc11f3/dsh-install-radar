const fs = require('node:fs')

const file = 'E:/DeepSeek Harness/shuju/profiles/desktop/package.json'
const raw = fs.readFileSync(file, 'utf8')
const pkg = JSON.parse(raw)
const before = pkg.dependencies['dsh-purge']
pkg.dependencies['dsh-purge'] = 'file:vendor/dsh-purge'
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

const check = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log('before:', before)
console.log('after :', check.dependencies['dsh-purge'])
console.log('bundles has dsh-purge:', check.dsh.profile.bundles.includes('dsh-purge'))
console.log('bundles has dsh-install-radar:', check.dsh.profile.bundles.includes('dsh-install-radar'))
console.log('radar dep:', check.dependencies['dsh-install-radar'])
const bytes = fs.readFileSync(file)
console.log('BOM?', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
