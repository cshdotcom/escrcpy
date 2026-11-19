#!/usr/bin/env node
/**
 * Icon integrity gate.
 *
 * Scans renderer sources for UnoCSS icon classes (i-<collection>-<icon>) and
 * verifies every one of them was actually generated into the built CSS
 * (desktop/dist/assets/*.css). A missing class means the icon does not exist
 * in the installed @iconify/json collections, so the element renders as an
 * invisible empty box — exactly the "transparent button without an icon"
 * regression seen in v3.4.0.
 *
 * Run after `pnpm build` (needs desktop/dist to exist):
 *   node scripts/check-icons.js
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const srcDirs = ['desktop/src', 'desktop/pages', 'packages']
const distAssetsDir = join(root, 'desktop/dist/assets')

if (!existsSync(distAssetsDir)) {
  console.error('✗ desktop/dist/assets not found — run `pnpm build` first')
  process.exit(1)
}

// Every icon class used in source (i- followed by at least two dash groups).
const iconPattern = /\bi-([a-z0-9]+(?:-[a-z0-9]+)+)\b/g
const used = new Map()

function scan(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(full)
    }
    else if (/\.(vue|js|ts|jsx|tsx|html)$/.test(entry.name)) {
      const text = readFileSync(full, 'utf8')
      for (const match of text.matchAll(iconPattern)) {
        if (!used.has(match[0])) {
          used.set(match[0], full)
        }
      }
    }
  }
}

for (const dir of srcDirs) {
  scan(join(root, dir))
}

// Classes generated into the built CSS.
const cssClasses = new Set()
for (const file of readdirSync(distAssetsDir)) {
  if (!file.endsWith('.css')) {
    continue
  }
  const css = readFileSync(join(distAssetsDir, file), 'utf8')
  for (const match of css.matchAll(/\.([a-zA-Z0-9-_\\/]+)/g)) {
    cssClasses.add(match[1].replace(/\\\//g, '/').replace(/\\/g, ''))
  }
}

const missing = [...used.keys()].filter(icon => !cssClasses.has(icon))

if (missing.length > 0) {
  console.error(`✗ ${missing.length} icon class(es) used in source are missing from the build:`)
  for (const icon of missing) {
    console.error(`  .${icon}  (first used in ${used.get(icon).replace(root, '')})`)
  }
  console.error('\nThe icon name probably does not exist in the installed @iconify/json collections.')
  console.error('Check available names with: node -e "const d=require(\'@iconify/json/json/solar.json\');console.log(Object.keys(d.icons).filter(n=>n.includes(\'KEYWORD\')))"')
  process.exit(1)
}

console.log(`✓ all ${used.size} icon classes used in source are present in the build`)
