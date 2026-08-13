import { readdirSync } from 'fs'
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
