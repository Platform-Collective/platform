//
// Copyright © 2026 Exaviz.
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

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeLocalesTest } from '@hcengineering/platform'

// T-50. Note what this does NOT prove: makeLocalesTest compares only ['en','ru'] and does so
// structurally, so it proves the files load and share a shape, not that they are translated.
it(
  'Locales are equale',
  makeLocalesTest((lang) => import(`../../lang/${lang}.json`))
)

// T-51. addStringsLoader imports a locale dynamically, so a missing file throws at runtime for
// that locale only, which the test above cannot catch. Resolve from __dirname and assert the
// count, so an empty or misresolved read is red rather than vacuously green.
it('has a lang file for every locale the platform ships', () => {
  const dir = join(__dirname, '../../lang')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  expect(files).toHaveLength(14)
  expect(files).toEqual(
    expect.arrayContaining([
      'cs.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'it.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'pt-br.json',
      'pt.json',
      'ru.json',
      'tr.json',
      'zh.json'
    ])
  )
})

// T-52. Review round 5: every non-English file was a byte copy of en.json and both tests above
// stayed green. Check each locale against en directly: the same keys in the same order, no empty
// value, the same {placeholders}, and a real translation for every string except the names that
// stay as they are in every language.
const LOCALES = ['cs', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'pt-br', 'ru', 'tr', 'zh']
const KEPT_AS_IS = new Set(['Emoji', 'Gifs', 'Giphy', 'PoweredByGiphy'])

function readStrings (lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(__dirname, '../../lang', `${lang}.json`), 'utf8')).string
}

function placeholders (value: string): string[] {
  return (value.match(/\{[^{}]*\}/g) ?? []).sort()
}

describe.each(LOCALES)('%s.json', (lang) => {
  const en = readStrings('en')
  const strings = readStrings(lang)

  it('has the same keys as en.json, in the same order', () => {
    expect(Object.keys(strings)).toEqual(Object.keys(en))
  })

  it('has no empty value and keeps every placeholder', () => {
    for (const key of Object.keys(en)) {
      expect(typeof strings[key]).toBe('string')
      expect(strings[key].trim()).not.toBe('')
      expect(placeholders(strings[key])).toEqual(placeholders(en[key]))
    }
  })

  it('is translated rather than copied from en.json', () => {
    const copied = Object.keys(en).filter((key) => !KEPT_AS_IS.has(key) && strings[key] === en[key])
    expect(copied).toEqual([])
  })
})
