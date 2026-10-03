//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

export interface OptionItem {
  id: string
  // Already translated
  label: string
  checked: boolean
  // Shown dimmed after the label, e.g. "Read only"
  note?: string
}

export interface OptionSection {
  id: string
  // Already translated
  title?: string
  // A single section behaves like radio buttons, a multi section like check boxes
  mode: 'single' | 'multi'
  items: OptionItem[]
}
