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
import { type AnySvelteComponent } from '@hcengineering/ui'
import { writable, derived, get, type Readable } from 'svelte/store'
import LoginIcon from './components/icons/LoginIcon.svelte'

/**
 * Names of supported login themes.
 */
export type LoginThemeName = 'huly'

/**
 * Theme description for login UI.
 */
export interface LoginTheme {
  name: LoginThemeName
  alignment: 'left' | 'center' | 'right'
  showTitle: boolean
  showLoginTitle: boolean
  backgroundComponent?: AnySvelteComponent
  logoComponent?: AnySvelteComponent
  // optional html accent class (corresponds to classes in _accent-colors.scss)
  accentClass?: string
}

/**
 * Built-in themes for login-resources.
 */
export const themes: Record<LoginThemeName, LoginTheme> = {
  huly: {
    name: 'huly',
    alignment: 'center',
    backgroundComponent: undefined,
    logoComponent: LoginIcon,
    showTitle: true,
    showLoginTitle: false,
    accentClass: 'accent-huly'
  }
}

/**
 * Default theme name used on startup.
 */
export const DEFAULT_THEME_NAME: LoginThemeName = 'huly'

/**
 * Writable store that holds current theme name.
 */
export const loginThemeName = writable<LoginThemeName>(DEFAULT_THEME_NAME)

/**
 * Readable store that resolves to the active theme object.
 */
export const loginTheme: Readable<LoginTheme> = derived(loginThemeName, ($name) => {
  return themes[$name]
})

/**
 * Set the current login theme by name. Throws on unknown theme name.
 */
export function setLoginTheme (name: LoginThemeName): void {
  if (!(name in themes)) {
    throw new Error(`Unknown login theme: ${String(name)}`)
  }
  loginThemeName.set(name)
}

/**
 * Apply accent class to the document <html> element for the provided theme.
 */
export function applyHtmlAccent (arg?: LoginThemeName | LoginTheme): void {
  if (typeof document === 'undefined') return

  let name: LoginThemeName
  if (typeof arg === 'string') {
    name = arg
  } else if (arg?.name !== undefined) {
    name = arg.name
  } else {
    name = get(loginThemeName)
  }

  const docCls = document.documentElement.classList
  for (const c of Array.from(docCls)) {
    if (c.startsWith('accent-')) docCls.remove(c)
  }

  const accent = themes[name]?.accentClass
  if (accent !== undefined && accent !== null && accent !== '') {
    docCls.add(accent)
  }
}

// Automatically apply accent class when theme changes
loginThemeName.subscribe((n) => {
  applyHtmlAccent(n)
})
