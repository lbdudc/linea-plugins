import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

// The pages of the agents were moved here from an application of their own. Vite resolves an import when the page is opened, so a
// page whose import does not exist works in the editor until somebody opens it (and fails the build). This opens all of them.
const root = path.resolve(__dirname, '../../client')
const files = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(js|vue)$/.test(entry.name)) files.push(full)
  }
}
walk(root)

const exists = (base) => ['', '.js', '.vue', '/index.js'].some((ext) => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile())
const specifiers = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])

describe('the client of the agents plugin', () => {
  it('has files', () => expect(files.length).toBeGreaterThan(50))

  it('imports only what exists', () => {
    const missing = []
    for (const file of files) {
      for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
        if (!exists(path.resolve(path.dirname(file), spec))) missing.push(`${path.relative(root, file)} -> ${spec}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has no import of the application these pages came from (src/…) that LINEA does not have', () => {
    const own = ['src/components/', 'src/pages/', 'src/stores/', 'src/api/', 'src/layouts/', 'src/boot/ws', 'src/router/', 'src/i18n/']
    const bad = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const m of text.matchAll(/from\s+'(src\/[^']+)'/g)) {
        // `src/` is LINEA's: only what LINEA has may be asked of it
        const target = path.resolve(__dirname, '../../../../linea/apps/client', m[1])
        if (!['', '.js', '.vue', '/index.js'].some((ext) => fs.existsSync(target + ext))) bad.push(`${path.relative(root, file)} -> ${m[1]}`)
        if (own.some((p) => m[1].startsWith(p)) && !fs.existsSync(target + '.js') && !fs.existsSync(target + '.vue')) bad.push(m[1])
      }
    }
    expect(bad).toEqual([])
  })
})
