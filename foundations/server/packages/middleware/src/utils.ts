//
// Copyright © 2023 Hardcore Engineering Inc.
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

import core, {
  type Account,
  AccountRole,
  systemAccountUuid,
  TxProcessor,
  type Doc,
  type DocumentUpdate,
  type Hierarchy,
  type MeasureContext,
  type SessionData,
  type Tx,
  type TxCUD
} from '@hcengineering/core'

export function isOwner (account: Account, ctx: MeasureContext<SessionData>): boolean {
  return account.role === AccountRole.Owner || isSystem(account, ctx)
}

export function isSystem (account: Account, ctx: MeasureContext<SessionData>): boolean {
  return account.uuid === systemAccountUuid
}

export function filterBroadcastOnly (tx: Tx[], hierarchy: Hierarchy): Tx[] {
  const ftx = tx.filter((it) => {
    if (TxProcessor.isExtendsCUD(it._class)) {
      const cud = it as TxCUD<Doc>
      const bonly = hierarchy.getClassifierProp(cud.objectClass, 'broadcastOnly')
      if (bonly === true) {
        return false
      }
      try {
        const objClass = hierarchy.getClass(cud.objectClass)
        const mix = hierarchy.hasMixin(objClass, core.mixin.TransientConfiguration)
        if (mix && hierarchy.as(objClass, core.mixin.TransientConfiguration).broadcastOnly) {
          hierarchy.setClassifierProp(cud.objectClass, 'broadcastOnly', true)
          // We do not need to store a broadcast only transactions into model.
          return false
        }
      } catch {
        return true
      }
    }
    return true
  })
  return ftx
}

/** Return updated root attributes, including both ends of a rename. Unknown operators fail closed. */
export function getUpdatedAttributes (operations: DocumentUpdate<Doc>): Set<string> | 'all' {
  const result = new Set<string>()
  for (const [key, value] of Object.entries(operations)) {
    if (!key.startsWith('$')) {
      result.add(key.split('.')[0])
      continue
    }
    if (!['$push', '$pull', '$inc', '$unset', '$update', '$rename', '$set'].includes(key)) return 'all'
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'all'
    for (const [path, destination] of Object.entries(value)) {
      result.add(path.split('.')[0])
      if (key === '$rename') {
        if (typeof destination !== 'string') return 'all'
        result.add(destination.split('.')[0])
      }
    }
  }
  return result
}
