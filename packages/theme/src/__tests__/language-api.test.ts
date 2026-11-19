// SPDX-License-Identifier: EPL-2.0

const mockLoadPluginStrings = jest.fn(async () => {})
const mockSetMetadata = jest.fn()
const mockSetTag = jest.fn()
jest.mock('@hcengineering/analytics', () => ({ Analytics: { setTag: mockSetTag } }))
jest.mock('@hcengineering/platform-rig/profiles/ui/svelte', () => ({}), { virtual: true })
jest.mock('@hcengineering/platform', () => ({
  __esModule: true,
  default: { metadata: { locale: 'locale' } },
  loadPluginStrings: mockLoadPluginStrings,
  setMetadata: mockSetMetadata
}))
jest.mock('svelte/store', () => ({
  derived: jest.fn(),
  writable: (value: unknown) => ({
    set: (next: unknown) => {
      value = next
    },
    subscribe: (fn: (v: unknown) => void) => {
      fn(value)
      return () => {}
    }
  }),
  get: (store: { subscribe: (fn: (v: unknown) => void) => () => void }) => {
    let result: unknown
    store.subscribe((value) => {
      result = value
    })()
    return result
  }
}))
jest.mock('../Theme.svelte', () => ({}))
jest.mock('../InvertedTheme.svelte', () => ({}))

describe('language startup API', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let values: Map<string, string>
  let theme: typeof import('../index')

  beforeEach(async () => {
    jest.resetModules()
    jest.clearAllMocks()
    values = new Map([['languagePreferenceVersion', '1']])
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value)
        },
        removeItem: (key: string) => {
          values.delete(key)
        }
      }
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { languages: ['de-AT'], language: 'de-AT' }
    })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: '' } } })
    theme = await import('../index')
  })

  afterAll(() => {
    for (const [key, descriptor] of [
      ['localStorage', originalStorage],
      ['navigator', originalNavigator],
      ['document', originalDocument]
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
      else Object.defineProperty(globalThis, key, descriptor)
    }
  })

  test('the one-argument API preserves supported existing choices', () => {
    values.set('languagePreference:anonymous:v1', 'fr')
    theme.setDefaultLanguage('en')
    expect(theme.getCurrentLanguage()).toBe('fr')
    expect(values.get('languagePreference:anonymous:v1')).toBe('fr')
  })

  test('configuration and automatic reads do not create a saved preference', () => {
    theme.setDefaultLanguage('en')
    expect(theme.getCurrentLanguage()).toBe('de')
    expect(values.has('languagePreference:anonymous:v1')).toBe(false)
    theme.setLanguagePreference('en')
    expect(values.get('languagePreference:anonymous:v1')).toBe('en')
    expect(theme.getCurrentLanguage()).toBe('en')
  })

  test('the configured allowlist applies before mounting', () => {
    theme.setDefaultLanguage('fr', ['en', 'fr'])
    expect(theme.getCurrentLanguage()).toBe('fr')
    expect(values.has('languagePreference:anonymous:v1')).toBe(false)
  })

  test('sets the analytics tag only when the resolved language changes', () => {
    theme.setDefaultLanguage('en')
    expect(theme.getCurrentLanguage()).toBe('de')
    expect(theme.getCurrentLanguage()).toBe('de')
    expect(mockSetTag).toHaveBeenCalledTimes(1)
    expect(mockSetTag).toHaveBeenLastCalledWith('language', 'de')

    theme.setLanguagePreference('fr')
    expect(theme.getCurrentLanguage()).toBe('fr')
    expect(theme.getCurrentLanguage()).toBe('fr')
    expect(mockSetTag).toHaveBeenCalledTimes(2)
    expect(mockSetTag).toHaveBeenLastCalledWith('language', 'fr')
  })

  test('initialization sets locale and document language and awaits translation loading', async () => {
    let finish: () => void = () => {}
    mockLoadPluginStrings.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    let ready = false
    const initialization = theme.initializeLanguage().then(() => {
      ready = true
    })
    expect(mockSetMetadata).toHaveBeenCalledWith('locale', 'de')
    expect(document.documentElement.lang).toBe('de')
    expect(mockLoadPluginStrings).toHaveBeenCalledWith('de')
    expect(ready).toBe(false)
    finish()
    await initialization
    expect(ready).toBe(true)
  })
  test('repeated initialization is a no-op', async () => {
    await theme.initializeLanguage()
    await theme.initializeLanguage()

    expect(mockLoadPluginStrings).toHaveBeenCalledTimes(1)
    expect(mockSetMetadata).toHaveBeenCalledTimes(1)
  })
  test('language selection updates the mounted Theme stores and document', async () => {
    const read = <T> (store: { subscribe: (fn: (value: T) => void) => () => void }): T | undefined => {
      let result: T | undefined
      store.subscribe((value) => {
        result = value
      })()
      return result
    }
    await theme.initializeLanguage()
    await theme.selectLanguagePreference('fr')
    expect(document.documentElement.lang).toBe('fr')
    expect(read(theme.currentLanguageStore)).toBe('fr')
    expect(read(theme.languagePreferenceStore)).toBe('fr')
    await theme.selectLanguagePreference(null)
    expect(document.documentElement.lang).toBe('de')
    expect(read(theme.currentLanguageStore)).toBe('de')
    expect(read(theme.languagePreferenceStore)).toBeNull()
    expect(values.has('languagePreference:anonymous:v1')).toBe(false)
  })
})
