// SPDX-License-Identifier: EPL-2.0

import { areEqualMarkups, isEmptyMarkup } from '@hcengineering/text'

export function shouldPushDescriptionUpdate (currentDescription: string, originMarkup: string): boolean {
  return (
    !areEqualMarkups(currentDescription, originMarkup) &&
    !(isEmptyMarkup(currentDescription) && isEmptyMarkup(originMarkup))
  )
}
