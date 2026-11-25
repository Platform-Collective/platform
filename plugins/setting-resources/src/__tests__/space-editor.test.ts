// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import core, { ClassifierKind, Hierarchy, TxFactory } from '@hcengineering/core'
import type { Client, Class, Doc, Ref, Space, TypedSpace } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'
import { showPanel } from '@hcengineering/ui'
import type { Action, ActionCategory, ViewAction } from '@hcengineering/view'
import view from '@hcengineering/view'
import { getActions, invokeAction } from '@hcengineering/view-resources'
import { openSpaceEditor } from '../space-editor'

jest.mock('@hcengineering/ui', () => ({
  showPanel: jest.fn()
}))

jest.mock('@hcengineering/view-resources', () => ({
  getActions: jest.fn(),
  invokeAction: jest.fn()
}))

const projectClass = 'tracker:class:Project' as Ref<Class<TypedSpace>>
const editChannel = 'chunter:component:EditChannel' as AnyComponent

function space (id: string, _class: Ref<Class<Space>>): Space {
  return {
    _id: id as Ref<Space>,
    _class,
    space: core.space.Space,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    name: id,
    description: '',
    private: false,
    archived: false,
    members: []
  }
}

function hierarchy (): Hierarchy {
  const result = new Hierarchy()
  const factory = new TxFactory(core.account.System)
  const classes: Array<[Ref<Class<Doc>>, Ref<Class<Doc>> | undefined]> = [
    [core.class.Obj, undefined],
    [core.class.Doc, core.class.Obj],
    [core.class.Class, core.class.Doc],
    [core.class.Space, core.class.Doc],
    [core.class.TypedSpace, core.class.Space],
    [chunter.class.Channel, core.class.Space],
    [projectClass, core.class.TypedSpace]
  ]
  for (const [id, parent] of classes) {
    result.tx(
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { kind: ClassifierKind.CLASS, extends: parent, label: core.string.Space },
        id
      )
    )
  }
  result.tx(
    factory.createTxCreateDoc(
      core.class.Mixin,
      core.space.Model,
      { kind: ClassifierKind.MIXIN, extends: core.class.Class, label: core.string.Space },
      view.mixin.ObjectEditor
    )
  )
  result.tx(
    factory.createTxMixin(chunter.class.Channel, core.class.Class, core.space.Model, view.mixin.ObjectEditor, {
      editor: editChannel
    })
  )
  return result
}

function client (h: Hierarchy, fullSpace: Space | undefined): Client {
  return {
    findOne: jest.fn(async () => fullSpace),
    getHierarchy: () => h
  } as unknown as Client
}

const editProjectAction: Action = {
  _id: 'tracker:action:EditProject' as Ref<Action>,
  _class: view.class.Action,
  space: core.space.Model,
  modifiedOn: 0,
  modifiedBy: core.account.System,
  label: 'tracker:string:EditProject' as IntlString,
  category: 'tracker:category:Tracker' as Ref<ActionCategory>,
  target: projectClass,
  input: 'focus',
  action: 'tracker:actionImpl:EditProject' as ViewAction,
  visibilityTester: 'view:function:CanEditSpace' as Action['visibilityTester'],
  context: { mode: ['context', 'browser'], group: 'edit' }
}

const editWorkflowAction: Action = {
  ...editProjectAction,
  _id: 'tracker:action:EditWorkflowStatuses' as Ref<Action>,
  visibilityTester: undefined
}

describe('space editor navigation', () => {
  const event = new Event('click')

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens the registered channel editor instead of the conversation link provider', async () => {
    const projected = space('channel', chunter.class.Channel)
    const full = { ...projected, description: 'Fully loaded channel' }
    const mockClient = client(hierarchy(), full)
    jest.mocked(getActions).mockResolvedValue([])

    await openSpaceEditor(mockClient, projected, event)

    expect(mockClient.findOne).toHaveBeenCalledWith(
      chunter.class.Channel,
      { _id: projected._id },
      { showArchived: true }
    )
    expect(showPanel).toHaveBeenCalledWith(editChannel, full._id, full._class, 'content')
    expect(invokeAction).not.toHaveBeenCalled()
  })

  it('invokes the permitted project edit action with the fully loaded object', async () => {
    const projected = space('project', projectClass)
    const full = { ...projected, description: 'Fully loaded project' }
    const mockClient = client(hierarchy(), full)
    jest.mocked(getActions).mockResolvedValue([editWorkflowAction, editProjectAction])

    await openSpaceEditor(mockClient, projected, event)

    expect(mockClient.findOne).toHaveBeenCalledWith(projectClass, { _id: projected._id }, { showArchived: true })
    expect(getActions).toHaveBeenCalledWith(mockClient, full)
    expect(invokeAction).toHaveBeenCalledWith(full, event, editProjectAction)
    expect(showPanel).not.toHaveBeenCalled()
  })

  it('does not open an editor when the projected space no longer exists', async () => {
    const projected = space('missing', chunter.class.Channel)
    const mockClient = client(hierarchy(), undefined)

    await openSpaceEditor(mockClient, projected, event)

    expect(getActions).not.toHaveBeenCalled()
    expect(showPanel).not.toHaveBeenCalled()
    expect(invokeAction).not.toHaveBeenCalled()
  })
})
