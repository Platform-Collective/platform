//
// Copyright © 2025 Hardcore Engineering Inc.
// Copyright © 2026 Intabia Fusion.
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
// limitations under the License

import { type PersonId, type Ref, type Space } from '@hcengineering/core'
import { type IntlString } from '@hcengineering/platform'
import { createQuery, getClient } from '@hcengineering/presentation'
import pulse, { type TypingIndicator } from '@hcengineering/pulse'

export interface TypingInfo {
  socialId: PersonId
  objectId: string
  status?: IntlString
}

export interface TypingActionParams {
  socialId: PersonId
  objectId: string
  onTyping: (typing: Map<string, TypingInfo>) => void
}

function typingDocId (objectId: string, socialId: PersonId): Ref<TypingIndicator> {
  return `typing:${objectId}:${socialId}` as Ref<TypingIndicator>
}

export function typing (node: HTMLElement, params: TypingActionParams): any {
  const liveQuery = createQuery(true)
  let state = new Map<string, TypingInfo>()

  let socialId = params.socialId
  let objectId = params.objectId
  let onTyping = params.onTyping

  function runQuery (): void {
    liveQuery.query(pulse.class.TypingIndicator, { objectId }, (result) => {
      const next = new Map<string, TypingInfo>()
      for (const doc of result) {
        if (doc.socialId === socialId) continue
        next.set(doc._id, { socialId: doc.socialId, objectId: doc.objectId, status: doc.status })
      }
      state = next
      onTyping(state)
    })
  }

  runQuery()

  return {
    update: (params: TypingActionParams) => {
      const needResubscribe = objectId !== params.objectId || socialId !== params.socialId
      socialId = params.socialId
      objectId = params.objectId
      onTyping = params.onTyping

      if (needResubscribe) {
        state = new Map<string, TypingInfo>()
        onTyping(state)
        runQuery()
      }
    },
    destroy: () => {
      liveQuery.unsubscribe()
    }
  }
}

export async function setTyping (
  socialId: PersonId,
  objectId: string,
  space: Ref<Space>,
  status?: IntlString
): Promise<void> {
  try {
    const client = getClient()
    const id = typingDocId(objectId, socialId)
    const existing = await client.findOne(pulse.class.TypingIndicator, { _id: id })
    if (existing !== undefined) {
      await client.diffUpdate(existing, { status })
      return
    }
    await client.createDoc(pulse.class.TypingIndicator, space, { objectId, socialId, status }, id)
  } catch (err) {
    console.warn('failed to set typing:', err)
  }
}

export async function clearTyping (socialId: PersonId, objectId: string): Promise<void> {
  try {
    const client = getClient()
    const id = typingDocId(objectId, socialId)
    const existing = await client.findOne(pulse.class.TypingIndicator, { _id: id })
    if (existing !== undefined) {
      await client.removeDoc(pulse.class.TypingIndicator, existing.space, existing._id)
    }
  } catch (err) {
    console.warn('failed to clear typing:', err)
  }
}
