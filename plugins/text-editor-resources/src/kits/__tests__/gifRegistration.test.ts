//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '../../../../..')
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8')

const WEB = 'dev/prod/src/platform.ts'
const DESKTOP = 'desktop/src/ui/platform.ts'

const idsPassedTo = (src: string, fn: string): string[] =>
  [...src.matchAll(new RegExp(`${fn}\\(\\s*([A-Za-z0-9_]+)`, 'g'))].map((m) => m[1]).sort()

describe('platform registration parity', () => {
  it('reads real files, not an empty string', () => {
    expect(read(WEB).length).toBeGreaterThan(1000)
    expect(read(DESKTOP).length).toBeGreaterThan(1000)
  })

  // T-41. The desktop app bundles its own front, so this list is maintained twice by hand.
  // Miss the desktop copy and the web app works perfectly while the Mac app silently lacks
  // the feature. Upstream already carries a divergence of this shape on the emoji line.
  // Desktop is allowed MORE than web - desktopDownloadsId is legitimately desktop-only - but
  // never less. A plugin registered on web and missed on desktop is the silent failure.
  it.each(['addStringsLoader', 'addLocation'])('registers every web %s id on desktop too', (fn) => {
    const web = idsPassedTo(read(WEB), fn)
    const desktop = new Set(idsPassedTo(read(DESKTOP), fn))
    expect(web.filter((id) => !desktop.has(id))).toEqual([])
  })

  // T-28: the loaders are what make the strings and components resolve at runtime. Locale
  // files existing proves nothing about whether anything loads them.
  it.each([WEB, DESKTOP])('registers the gif plugin at all four points in %s', (file) => {
    const src = read(file)
    expect(src).toContain("import { gifId } from '@hcengineering/gif'")
    expect(src).toContain("import '@hcengineering/gif-assets'")
    expect(src).toContain('addStringsLoader(gifId')
    expect(src).toContain('addLocation(gifId')
  })
})

describe('package registration', () => {
  // T-39 companion: without the models/all builder entry the class does not exist at runtime
  // and nothing raises an error.
  it('registers the gif model in models/all', () => {
    const index = read('models/all/src/index.ts')
    expect(index).toContain("from '@hcengineering/model-gif'")
    expect(index).toMatch(/\[gifModel,\s*gifId\]/)
    expect(read('models/all/package.json')).toContain('"@hcengineering/model-gif"')
  })

  // T-42: a resources package without this script is silently skipped by rush svelte-check
  // while CI still reports green. 14 packages in this repo are already in that state.
  it('declares the svelte-check phase in gif-resources', () => {
    const pkg = JSON.parse(read('plugins/gif-resources/package.json'))
    expect(pkg.scripts['_phase:svelte-check']).toBe('do-svelte-check')
  })

  it('registers all four packages in rush.json', () => {
    const rush = read('rush.json')
    for (const name of [
      '@hcengineering/gif',
      '@hcengineering/gif-assets',
      '@hcengineering/gif-resources',
      '@hcengineering/model-gif'
    ]) {
      expect(rush).toContain(`"${name}"`)
    }
  })

  // T-48: this half of the feature talks to nothing outside the workspace, which is what
  // makes it safe to contribute and what keeps it working on a LAN with no egress.
  it('depends on no third-party network library', () => {
    for (const p of ['plugins/gif/package.json', 'plugins/gif-resources/package.json']) {
      const deps = Object.keys(JSON.parse(read(p)).dependencies ?? {})
      expect(deps.filter((d) => !d.startsWith('@hcengineering/') && d !== 'svelte')).toEqual([])
    }
  })
})
