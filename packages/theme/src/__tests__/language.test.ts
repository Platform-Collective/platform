// SPDX-License-Identifier: EPL-2.0

import { getBrowserLanguages, LanguagePreference, resolveLanguage, type LanguageOptions } from '../language'

const defaults: LanguageOptions = {
  supportedLanguages: ['en', 'de', 'fr', 'pt', 'pt-br', 'zh'],
  defaultLanguage: 'en'
}

function resolve (options: Partial<LanguageOptions>): string {
  return resolveLanguage({ ...defaults, ...options })
}

describe('UI language precedence', () => {
  test.each([
    [['de-AT'], 'de'],
    [['en-US'], 'en'],
    [['fr'], 'fr'],
    [['xx-ZZ', 'de-AT', 'fr'], 'de'],
    [['de-AT', 'fr'], 'de'],
    [['pt-BR', 'de'], 'pt-br'],
    [['zh-Hant-TW'], 'zh'],
    [['de-DE-u-co-phonebk', 'fr'], 'de'],
    [['de-DE-x-custom', 'fr'], 'de']
  ])('uses the first supported browser entry %j -> %s', (browserLanguages, expected) => {
    expect(resolve({ browserLanguages })).toBe(expected)
  })

  test('the first entry base match wins over a later exact match', () => {
    expect(resolve({ browserLanguages: ['de-AT', 'fr'] })).toBe('de')
  })

  test('explicit user choice wins over browser and deployment', () => {
    expect(resolve({ explicitLanguage: 'fr', browserLanguages: ['de-AT'], defaultLanguage: 'de' })).toBe('fr')
    expect(resolve({ explicitLanguage: 'en', browserLanguages: ['de-AT'] })).toBe('en')
  })

  test('an explicit English preference wins after migration', () => {
    expect(resolve({ explicitLanguage: 'en', browserLanguages: ['de-AT'] })).toBe('en')
  })

  test('ignores empty, unsupported and malformed saved values', () => {
    for (const explicitLanguage of ['', 'xx', 'not a locale', 'de--AT']) {
      expect(resolve({ explicitLanguage, browserLanguages: ['de-AT'] })).toBe('de')
    }
  })

  test('normalizes case and region of saved values', () => {
    expect(resolve({ explicitLanguage: 'DE-at' })).toBe('de')
    expect(resolve({ explicitLanguage: 'PT-BR' })).toBe('pt-br')
  })

  test('respects the deployment supported language list', () => {
    expect(resolve({ browserLanguages: ['de-AT', 'fr'], supportedLanguages: ['en', 'fr'] })).toBe('fr')
  })

  test('uses deployment default only when the browser has no supported match', () => {
    expect(resolve({ browserLanguages: ['xx-ZZ'], defaultLanguage: 'de' })).toBe('de')
    expect(resolve({ browserLanguages: [], defaultLanguage: 'de-AT' })).toBe('de')
    expect(resolve({ defaultLanguage: 'de' })).toBe('de')
  })

  test('falls back to English for absent, invalid or disabled defaults, including an empty allowlist', () => {
    for (const defaultLanguage of [undefined, '', 'xx', 'not a locale']) {
      expect(resolve({ browserLanguages: ['xx-ZZ'], defaultLanguage })).toBe('en')
    }
    expect(resolve({ defaultLanguage: 'de', supportedLanguages: ['fr'] })).toBe('en')
    expect(resolve({ defaultLanguage: 'de', supportedLanguages: [] })).toBe('en')
  })

  test('does not mutate caller preferences or the allowlist', () => {
    const supportedLanguages = Object.freeze(['en', 'de'])
    const browserLanguages = Object.freeze(['de-AT'])
    const options = Object.freeze({ supportedLanguages, browserLanguages })
    expect(resolveLanguage(options)).toBe('de')
  })
})

describe('explicit preference persistence', () => {
  function storage (): Pick<Storage, 'getItem' | 'removeItem'> & {
    values: Map<string, string>
    setItem: jest.MockedFunction<Storage['setItem']>
  } {
    const values = new Map([['languagePreferenceVersion', '1']])
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: jest.fn((key: string, value: string) => {
        values.set(key, value)
      }),
      removeItem: (key: string) => {
        values.delete(key)
      }
    }
  }
  test('automatic browser and deployment choices never save lang', () => {
    const saved = storage()
    const preference = new LanguagePreference(() => saved)
    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('de')
    expect(preference.get({ ...defaults, browserLanguages: ['fr'] })).toBe('fr')
    expect(preference.get({ ...defaults, defaultLanguage: 'de' })).toBe('de')
    expect(saved.setItem).not.toHaveBeenCalled()
  })
  test('preserves a saved non-default choice during migration', () => {
    const saved = storage()
    saved.values.delete('languagePreferenceVersion')
    saved.values.set('lang', 'fr')
    const preference = new LanguagePreference(() => saved)

    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('fr')
    expect(saved.values.get('languagePreference:anonymous:v1')).toBe('fr')
    expect(saved.values.has('lang')).toBe(false)
  })
  test('preserves a saved deployment default as an explicit choice', () => {
    const saved = storage()
    saved.values.delete('languagePreferenceVersion')
    saved.values.set('lang', 'en')
    const preference = new LanguagePreference(() => saved)

    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('en')
    expect(saved.values.get('languagePreference:anonymous:v1')).toBe('en')
  })
  test('explicitly pinning the detected language survives reload and a new browser locale', () => {
    const saved = storage()
    const preference = new LanguagePreference(() => saved)
    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('de')
    preference.set('de')
    expect(new LanguagePreference(() => saved).get({ ...defaults, browserLanguages: ['fr'] })).toBe('de')
    preference.set(null)
    expect(preference.get({ ...defaults, browserLanguages: ['fr'] })).toBe('fr')
  })
  test('storage access denial falls back and still permits a session preference', () => {
    const preference = new LanguagePreference(() => {
      throw new Error('Storage denied')
    })
    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('de')
    expect(() => {
      preference.set('fr')
    }).not.toThrow()
    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('fr')
    preference.set(null)
    expect(preference.get({ ...defaults, browserLanguages: ['de-AT'] })).toBe('de')
  })
})

describe('browser language inputs', () => {
  test('prefers navigator.languages order to navigator.language', () => {
    expect(getBrowserLanguages({ languages: ['fr', 'de-AT'], language: 'en-US' })).toEqual(['fr', 'de-AT'])
  })

  test('falls back to navigator.language when languages is empty', () => {
    const browserLanguages = getBrowserLanguages({ languages: [], language: 'de-AT' })
    expect(resolveLanguage({ ...defaults, browserLanguages })).toBe('de')
  })

  test('works without a browser', () => {
    expect(getBrowserLanguages()).toEqual([])
  })

  test('normalizes configured asset IDs and skips malformed browser entries', () => {
    expect(resolve({ supportedLanguages: [' en ', ' DE '], browserLanguages: ['de--AT', 'DE-at'] })).toBe('de')
  })
})
