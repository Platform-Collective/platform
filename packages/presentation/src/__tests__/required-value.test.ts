// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import type { AnyAttribute } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import { EmptyMarkup } from '@hcengineering/text'
import { isRequiredValueEmpty } from '../required-value'

function attribute (_class: AnyAttribute['type']['_class']): Pick<AnyAttribute, 'type'> {
  return { type: { _class, label: 'Test' as IntlString } }
}

describe('isRequiredValueEmpty', () => {
  it('treats missing, blank, empty and non-finite values as empty', () => {
    const text = attribute(core.class.TypeString)
    expect(isRequiredValueEmpty(text, undefined)).toBe(true)
    expect(isRequiredValueEmpty(text, null)).toBe(true)
    expect(isRequiredValueEmpty(text, '')).toBe(true)
    expect(isRequiredValueEmpty(text, '  \n')).toBe(true)
    expect(isRequiredValueEmpty(text, [])).toBe(true)
    expect(isRequiredValueEmpty(text, Number.NaN)).toBe(true)
    expect(isRequiredValueEmpty(attribute(core.class.TypeMarkup), EmptyMarkup)).toBe(true)
  })

  it('treats real values, zero and false as filled', () => {
    const text = attribute(core.class.TypeString)
    expect(isRequiredValueEmpty(text, 'value')).toBe(false)
    expect(isRequiredValueEmpty(text, 0)).toBe(false)
    expect(isRequiredValueEmpty(text, false)).toBe(false)
    expect(isRequiredValueEmpty(text, ['a'])).toBe(false)
    expect(isRequiredValueEmpty(attribute(core.class.TypeMarkup), '<p>value</p>')).toBe(false)
  })
})
