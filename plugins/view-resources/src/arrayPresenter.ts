// SPDX-License-Identifier: EPL-2.0

import type { AnyComponent } from '@hcengineering/ui'
import type { AttributePresenter } from '@hcengineering/view'

/**
 * Return the array presenter of a presenter mixin, or undefined when the mixin or the field is missing.
 *
 * Mixins returned by Hierarchy are proxies with only a `get` trap, so an `in` check looks at the class
 * document instead of the mixin fields. Read the property instead.
 */
export function getArrayPresenter (
  presenterMixin: Pick<AttributePresenter, 'presenter' | 'arrayPresenter'> | undefined
): AnyComponent | undefined {
  return presenterMixin?.arrayPresenter
}
