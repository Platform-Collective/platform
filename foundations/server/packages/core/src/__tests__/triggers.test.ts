//
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
// limitations under the License.
//

import core, {
  ClassifierKind,
  DOMAIN_MODEL,
  Hierarchy,
  MeasureMetricsContext,
  type ModelDb,
  TxFactory,
  type Class,
  type Data,
  type Doc,
  type DocumentQuery,
  type Obj,
  type Ref,
  type Tx
} from '@hcengineering/core'
import { addLocation } from '@hcengineering/platform'
import { Triggers } from '../triggers'
import serverCore, { serverCoreId } from '../plugin'
import type { TriggerControl } from '../types'

const ctx = new MeasureMetricsContext('test', {})
const factory = new TxFactory(core.account.System)

const BASE = 'test:class:Base' as Ref<Class<Doc>>
const DERIVED = 'test:class:Derived' as Ref<Class<Doc>>

function classTx (_id: Ref<Class<Obj>>, ext: Ref<Class<Obj>> | undefined): Tx {
  return factory.createTxCreateDoc(
    core.class.Class,
    core.space.Model,
    { kind: ClassifierKind.CLASS, extends: ext, label: 'x', domain: DOMAIN_MODEL } as unknown as Data<Class<Obj>>,
    _id
  )
}

describe('Triggers', () => {
  it('does not expand txMatch inside the model document', async () => {
    addLocation(serverCoreId, async () => ({ default: async () => ({ trigger: { OnTrigger: async () => [] } }) }))

    const h = new Hierarchy()
    for (const tx of [
      classTx(core.class.Obj, undefined),
      classTx(core.class.Doc, core.class.Obj),
      classTx(core.class.Class, core.class.Doc),
      classTx(core.class.Tx, core.class.Doc),
      classTx(core.class.TxCUD, core.class.Tx),
      classTx(core.class.TxCreateDoc, core.class.TxCUD),
      classTx(BASE, core.class.Doc),
      classTx(DERIVED, BASE)
    ]) {
      h.tx(tx)
    }

    // The instance a ModelDb hands out of its own storage, without a copy.
    const txMatch: DocumentQuery<Tx> = { objectClass: BASE }
    const trigger = {
      _id: 'test:trigger:One' as Ref<Doc>,
      _class: serverCore.class.Trigger,
      space: core.space.Model,
      modifiedBy: core.account.System,
      modifiedOn: 0,
      trigger: `${serverCoreId}:trigger:OnTrigger`,
      txMatch
    }
    const model = { findAllSync: () => [trigger] } as unknown as ModelDb

    const triggers = new Triggers(h)
    triggers.init(model)
    const control = {
      hierarchy: h,
      modelDb: model,
      txes: [],
      workspace: { uuid: 'ws' },
      apply: async () => ({})
    } as unknown as Omit<TriggerControl, 'txFactory'>

    // Expanding the query used to write $in back into the trigger document of the model.
    await triggers.apply(ctx, [factory.createTxCreateDoc(DERIVED, core.space.Model, {})], control, 'sync')

    expect(trigger.txMatch.objectClass).toBe(BASE)
  })
})
