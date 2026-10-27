// SPDX-License-Identifier: EPL-2.0
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

import { getChatMessageEditData } from '../chat-message-utils'

describe('getChatMessageEditData', () => {
  it('does not overwrite the collection-managed attachment counter', () => {
    const update = getChatMessageEditData({ message: '<p>Edited</p>', attachments: 1 }, 123)

    expect(update).toEqual({ message: '<p>Edited</p>', editedOn: 123 })
    expect(update).not.toHaveProperty('attachments')
  })
})
