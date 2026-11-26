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

import type { Attachment } from '@hcengineering/attachment'
import type { Ref } from '@hcengineering/core'
import { sortAttachments } from '../attachmentOrder'

type Item = Pick<Attachment, '_id' | 'createdOn'>

function item (id: string, createdOn?: number): Item {
  return { _id: id as Ref<Attachment>, createdOn }
}

const ids = (items: Item[]): string[] => items.map((it) => it._id)

describe('sortAttachments', () => {
  it('orders attachments by createdOn', () => {
    const items = [item('c', 300), item('a', 100), item('b', 200)]
    expect(ids(sortAttachments(items))).toEqual(['a', 'b', 'c'])
  })

  it('puts createdOn ahead of _id', () => {
    const items = [item('a', 200), item('z', 100)]
    expect(ids(sortAttachments(items))).toEqual(['z', 'a'])
  })

  it('breaks createdOn ties by _id', () => {
    const items = [item('65f0000000000003', 100), item('65f0000000000001', 100), item('65f0000000000002', 100)]
    expect(ids(sortAttachments(items))).toEqual(['65f0000000000001', '65f0000000000002', '65f0000000000003'])
  })

  it('treats a missing createdOn as 0', () => {
    const items = [item('a', 100), item('b')]
    expect(ids(sortAttachments(items))).toEqual(['b', 'a'])
  })

  it('does not modify the input array', () => {
    const items = [item('b', 200), item('a', 100)]
    const snapshot = [...items]
    const sorted = sortAttachments(items)
    expect(sorted).not.toBe(items)
    expect(items).toEqual(snapshot)
    expect(items[0]).toBe(snapshot[0])
  })
})
