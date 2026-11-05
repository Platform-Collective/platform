// SPDX-License-Identifier: EPL-2.0

import { DEFAULT_FONT_FAMILY } from '@hcengineering/branding'

/**
 * Font stacks with fallbacks available in common print environments.
 * Uploaded font assets give exact results everywhere.
 */
export const SYSTEM_FONTS: Array<{ id: string, label: string }> = [
  { id: DEFAULT_FONT_FAMILY, label: 'Sans-serif (Helvetica, Arial)' },
  { id: 'Georgia, "Times New Roman", serif', label: 'Serif (Georgia, Times)' },
  { id: '"Courier New", Courier, monospace', label: 'Monospace (Courier)' },
  { id: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { id: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { id: '"Noto Sans", sans-serif', label: 'Noto Sans' },
  { id: '"Noto Serif", serif', label: 'Noto Serif' }
]

export function fontOptions (customFonts: string[]): Array<{ id: string, label: string }> {
  const custom = customFonts.map((family) => ({ id: `"${family}", ${DEFAULT_FONT_FAMILY}`, label: `★ ${family}` }))
  return [...custom, ...SYSTEM_FONTS]
}
