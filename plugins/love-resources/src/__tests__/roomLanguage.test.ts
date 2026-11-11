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

import { getBrowserRoomLanguage, getRoomLanguageForLocale } from '../roomLanguage'

describe('getRoomLanguageForLocale', () => {
  it('keeps a supported regional locale', () => {
    expect(getRoomLanguageForLocale('en-GB')).toBe('en-GB')
    expect(getRoomLanguageForLocale('de-CH')).toBe('de-CH')
    expect(getRoomLanguageForLocale('zh-TW')).toBe('zh-TW')
  })

  it('matches supported locales case-insensitively', () => {
    expect(getRoomLanguageForLocale('pt-BR')).toBe('pt-br')
    expect(getRoomLanguageForLocale('EN-gb')).toBe('en-GB')
    expect(getRoomLanguageForLocale('de_CH')).toBe('de-CH')
  })

  it('falls back to the base language for unsupported regions', () => {
    expect(getRoomLanguageForLocale('de-AT')).toBe('de')
    expect(getRoomLanguageForLocale('fr-BE')).toBe('fr')
    expect(getRoomLanguageForLocale('zh-CN')).toBe('zh')
    expect(getRoomLanguageForLocale('ru')).toBe('ru')
  })

  it('falls back to the default for unsupported or missing locales', () => {
    expect(getRoomLanguageForLocale('xx-YY')).toBe('en')
    expect(getRoomLanguageForLocale('')).toBe('en')
    expect(getRoomLanguageForLocale(undefined)).toBe('en')
    expect(getRoomLanguageForLocale(null)).toBe('en')
  })

  it('uses the given fallback', () => {
    expect(getRoomLanguageForLocale('xx', 'de')).toBe('de')
  })
})

describe('getBrowserRoomLanguage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  afterEach(() => {
    if (original !== undefined) {
      Object.defineProperty(globalThis, 'navigator', original)
    } else {
      delete (globalThis as any).navigator
    }
  })

  it('maps navigator.language', () => {
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'es-MX' }, configurable: true })
    expect(getBrowserRoomLanguage()).toBe('es')
  })

  it('falls back when navigator is unavailable', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true })
    expect(getBrowserRoomLanguage()).toBe('en')
  })
})
