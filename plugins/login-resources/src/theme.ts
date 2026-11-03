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
import { getMetadata } from '@hcengineering/platform'
import { type AnySvelteComponent } from '@hcengineering/ui'
import { writable, derived, type Readable } from 'svelte/store'
import RelyFrameLogo from './components/icons/RelyFrameLogo.svelte'
import login from './plugin'

/**
 * Names of supported login themes.
 * Selected per host through the `loginTheme` field of branding.json.
 */
export type LoginThemeName = 'relyframe' | 'plain'

/**
 * Theme description for login UI.
 */
export interface LoginTheme {
  name: LoginThemeName
  alignment: 'left' | 'center' | 'right'
  showLoginTitle: boolean
  backgroundComponent?: AnySvelteComponent
  logoComponent?: AnySvelteComponent
  // Apply the brand accent colours (`.theme-brand-scope` from the theme package)
  brandAccent: boolean
}

/**
 * Built-in themes for login-resources.
 */
export const themes: Record<LoginThemeName, LoginTheme> = {
  relyframe: {
    name: 'relyframe',
    alignment: 'center',
    backgroundComponent: undefined,
    logoComponent: RelyFrameLogo,
    showLoginTitle: false,
    brandAccent: true
  },
  // Neutral look without platform logo or accent, for hosts that carry their own brand (e.g. TraceX)
  plain: {
    name: 'plain',
    alignment: 'center',
    backgroundComponent: undefined,
    logoComponent: undefined,
    showLoginTitle: false,
    brandAccent: false
  }
}

/**
 * Default theme name used when branding does not specify one.
 */
export const DEFAULT_THEME_NAME: LoginThemeName = 'relyframe'

/**
 * Checks that a value is the name of a registered theme (own keys only).
 */
export function isLoginThemeName (value: unknown): value is LoginThemeName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(themes, value)
}

function initialThemeName (): LoginThemeName {
  const fromBranding = getMetadata(login.metadata.LoginTheme)
  return isLoginThemeName(fromBranding) ? fromBranding : DEFAULT_THEME_NAME
}

/**
 * Writable store that holds current theme name.
 */
export const loginThemeName = writable<LoginThemeName>(initialThemeName())

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
  if (!isLoginThemeName(name)) {
    throw new Error(`Unknown login theme: ${String(name)}`)
  }
  loginThemeName.set(name)
}
