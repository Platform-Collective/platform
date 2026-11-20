// SPDX-License-Identifier: EPL-2.0

import { type Doc, type TxCreateDoc } from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import core, { createModel as createCoreModel } from '@hcengineering/model-core'
import presentation from '@hcengineering/model-presentation'
import { type AnyComponent, type ComponentExtensionId } from '@hcengineering/ui'

import { createModel } from '../index'
import chunter from '../plugin'

interface TestComponentPointExtension extends Doc {
  extension: ComponentExtensionId
}

function getRegistrations (
  builder: Builder,
  extension: ComponentExtensionId
): Array<TxCreateDoc<TestComponentPointExtension>> {
  return builder.getTxes().filter((tx): tx is TxCreateDoc<TestComponentPointExtension> => {
    if (tx._class !== core.class.TxCreateDoc) return false
    const create = tx as TxCreateDoc<TestComponentPointExtension>
    return (
      create.objectClass === presentation.class.ComponentPointExtension && create.attributes.extension === extension
    )
  })
}

describe('comment input extensions', () => {
  it('registers a test component without adding a production UI component', () => {
    const builder = new Builder()
    createCoreModel(builder)
    createModel(builder)
    expect(getRegistrations(builder, chunter.extensions.ChatMessageInput)).toHaveLength(0)

    const component = 'test.component.ChatMessageInputExtension' as AnyComponent
    builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
      extension: chunter.extensions.ChatMessageInput,
      component
    })

    const registrations = getRegistrations(builder, chunter.extensions.ChatMessageInput)
    expect(registrations).toHaveLength(1)
    expect(registrations[0].attributes).toMatchObject({ component })
  })
})
