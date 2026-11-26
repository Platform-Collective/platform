// SPDX-License-Identifier: EPL-2.0

import type { Asset } from '@hcengineering/platform'
import type { IconProps } from '@hcengineering/view'
import { getDocumentIconUpdate } from '../document-icon'

const documentIcon = 'document:icon:Document' as Asset
const emojiIcon = 'view:ids:IconWithEmoji' as Asset

describe('getDocumentIconUpdate', () => {
  const selections: IconProps[] = [
    { icon: documentIcon, color: 0 },
    { icon: documentIcon, color: 5 },
    { icon: emojiIcon, color: 0x1f600 },
    { icon: emojiIcon, color: [0x1f469, 0x200d, 0x1f4bb] }
  ]

  it.each(selections)('preserves a selected icon and color: %j', (selection) => {
    expect(getDocumentIconUpdate(selection)).toEqual(selection)
  })

  it('unsets both fields when restoring defaults', () => {
    expect(getDocumentIconUpdate({ icon: undefined, color: undefined })).toEqual({
      $unset: { icon: true, color: true }
    })
  })

  it.each([undefined, null])('does not update on popup cancellation (%s)', (result) => {
    expect(getDocumentIconUpdate(result)).toBeUndefined()
  })
})
