import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('./', import.meta.url))
const srcDir = path.resolve(__dirname, '..', 'src')

const rules = [
    { name: 'ui must not import from db directly (go through core)', check: noDirectGatewayFromUi },
    { name: 'core must not touch DOM (no document/window globals)', check: noDomInCore },
    { name: 'db is the only layer that touches host APIs (getContext/fetch/TavernHelper)', check: noHostApiOutsideDb },
]

function listTsWithin(dir) {
    const out = []
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) {
            out.push(...listTsWithin(full))
        } else if ((entry.endsWith('.ts') || entry.endsWith('.vue')) && !entry.endsWith('.d.ts')) {
            out.push(full)
        }
    }
    return out
}

function layerOf(file) {
    const rel = path.relative(srcDir, file).replace(/\\/g, '/')
    const top = rel.split('/')[0]
    return top
}

function noDirectGatewayFromUi() {
    const offenders = []
    for (const file of listTsWithin(path.join(srcDir, 'ui'))) {
        const text = readFileSync(file, 'utf8')
        if (/@db\//.test(text) || /from\s+['"]\.\.\/db/.test(text) || /from\s+['"]\.\.\/\.\.\/db/.test(text)) {
            offenders.push(file)
        }
    }
    return offenders
}

function noDomInCore() {
    const offenders = []
    for (const file of listTsWithin(path.join(srcDir, 'core'))) {
        const text = readFileSync(file, 'utf8')
        if (/\bdocument\b|\bwindow\b/.test(text)) {
            offenders.push(file)
        }
    }
    return offenders
}

function noHostApiOutsideDb() {
    const offenders = []
    const hostPatterns = /\bgetContext\b|\bTavernHelper\b|\bSillyTavern\b/
    for (const file of listTsWithin(srcDir)) {
        if (layerOf(file) === 'db') continue
        const text = readFileSync(file, 'utf8')
        if (hostPatterns.test(text)) {
            offenders.push(file)
        }
    }
    return offenders
}

let failed = false
for (const rule of rules) {
    const offenders = rule.check()
    if (offenders.length > 0) {
        console.error(`[check-arch] FAIL: ${rule.name}`)
        for (const file of offenders) {
            console.error(`  - ${path.relative(srcDir, file)}`)
        }
        failed = true
    } else {
        console.log(`[check-arch] ok: ${rule.name}`)
    }
}

if (failed) {
    process.exit(1)
}
