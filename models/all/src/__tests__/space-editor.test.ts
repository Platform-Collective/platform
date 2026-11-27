// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  TxOperations,
  setCurrentAccount
} from '@hcengineering/core'
import type { AccountUuid, Client, Permission, Ref, Role, Space, SpaceType, TypedSpace } from '@hcengineering/core'
import chunter, { chunterId } from '@hcengineering/model-chunter'
import { printId } from '@hcengineering/model-print'
import tracker, { trackerId } from '@hcengineering/model-tracker'
import view, { viewId } from '@hcengineering/model-view'
import { addEventListener, addLocation, PlatformEvent, removeEventListener } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { openSpaceEditor } from '@hcengineering/setting-resources/src/space-editor'
import { showPanel } from '@hcengineering/ui'
import { getActions } from '@hcengineering/view-resources'
import buildModel from '..'

jest.mock('@hcengineering/presentation', () => ({
  addRefreshListener: jest.fn(),
  createQuery: () => ({ query: jest.fn() }),
  getClient: jest.fn()
}))

jest.mock('@hcengineering/ui', () => ({
  resolvedLocationStore: { subscribe: jest.fn() },
  showPanel: jest.fn()
}))

// Use the production actions and visibility checks without loading the browser component barrel.
jest.mock('@hcengineering/view-resources', () => ({
  ...jest.requireActual<typeof import('@hcengineering/view-resources/src/actions')>(
    '@hcengineering/view-resources/src/actions'
  ),
  ...jest.requireActual<typeof import('@hcengineering/view-resources/src/visibilityTester')>(
    '@hcengineering/view-resources/src/visibilityTester'
  )
}))

const account = 'member' as AccountUuid
const click = new Event('click')
const editProject = jest.fn()
const deleteProject = jest.fn()
const editWorkflowStatuses = jest.fn()
const editorError = new Error('Unable to open project editor')

const builder = buildModel()
const projectType = builder.createDoc(core.class.SpaceType, core.space.Model, {
  name: 'Test project type',
  descriptor: tracker.descriptors.ProjectType,
  roles: 0,
  targetClass: tracker.mixin.ClassicProjectTypeData
})

function createRole (type: Ref<SpaceType>, permission: Ref<Permission>): Ref<Role> {
  return builder.createDoc(core.class.Role, core.space.Model, {
    attachedTo: type,
    attachedToClass: core.class.SpaceType,
    collection: 'roles',
    name: permission,
    permissions: [permission]
  })._id
}

const archiveRole = createRole(projectType._id, core.permission.ArchiveSpace)
const editRole = createRole(projectType._id, core.permission.UpdateSpace)
const deleteRole = createRole(core.spaceType.SpacesType, core.permission.DeleteObject)
const hierarchy = new Hierarchy()
const model = new ModelDb(hierarchy)
model.addTxes(new MeasureMetricsContext('space editor test', {}), builder.getTxes(), false)

function createClient (space: Space | undefined, canDelete = false): Client {
  const spaces: TypedSpace = {
    _id: core.space.Space,
    _class: core.class.TypedSpace,
    space: core.space.Space,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    name: 'Spaces',
    description: '',
    private: false,
    archived: false,
    members: [],
    type: core.spaceType.SpacesType,
    [core.mixin.SpacesTypeData]: { [deleteRole]: canDelete ? [account] : [] }
  }
  const storage = new ModelDb(hierarchy)
  storage.addDoc(spaces)
  if (space !== undefined) storage.addDoc(space)
  const client = {
    findOne: jest.fn(storage.findOne.bind(storage)),
    getHierarchy: () => hierarchy,
    getModel: () => model
  } as unknown as Client
  jest.mocked(getClient).mockReturnValue(new TxOperations(client, core.account.System))
  return client
}

function space (id: string, _class: Space['_class']): Space {
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
    members: [account]
  }
}

function project (archived: boolean, canEdit: boolean): Space {
  return Object.assign(space('project', tracker.class.Project), {
    description: 'Fully loaded project',
    archived,
    type: projectType._id,
    [tracker.mixin.ClassicProjectTypeData]: { [archiveRole]: [account], [editRole]: canEdit ? [account] : [] }
  })
}

function channel (canEdit: boolean): Space {
  return { ...space('channel', chunter.class.Channel), owners: canEdit ? [account] : [] }
}

beforeAll(() => {
  const visibility = jest.requireActual<typeof import('@hcengineering/view-resources/src/visibilityTester')>(
    '@hcengineering/view-resources/src/visibilityTester'
  )
  setCurrentAccount({
    uuid: account,
    role: AccountRole.User,
    primarySocialId: core.account.System,
    socialIds: [],
    fullSocialIds: []
  })
  addLocation(viewId, async () => ({
    default: async () => ({
      function: {
        CanArchiveSpace: visibility.canArchiveSpace,
        CanDeleteObject: visibility.canDeleteObject,
        CanDeleteSpace: visibility.canDeleteSpace,
        CanEditSpace: visibility.canEditSpace,
        CanJoinSpace: visibility.canJoinSpace,
        CanLeaveSpace: visibility.canLeaveSpace,
        CanCopyLink: () => false
      }
    })
  }))
  addLocation(chunterId, async () => ({
    default: async () => ({ function: { CanSummarizeMessages: () => false } })
  }))
  addLocation(printId, async () => ({
    default: async () => ({ function: { CanPrint: () => false } })
  }))
  addLocation(trackerId, async () => ({
    default: async () => ({
      actionImpl: { EditProject: editProject, DeleteProject: deleteProject, EditWorkflowStatuses: editWorkflowStatuses }
    })
  }))
})

beforeEach(() => {
  jest.clearAllMocks()
})

it.each([
  [false, tracker.action.DeleteProject],
  [true, tracker.action.DeleteProjectClean]
])('opens the project editor with the full space (archived=%s)', async (archived, competitor) => {
  const full = project(archived, true)
  const client = createClient(full, true)
  const projected = { ...full, name: 'Projected project', description: '' }
  const ids = (await getActions(client, full)).map((action) => action._id)
  expect(ids).toContain(competitor)
  expect(ids).toContain(tracker.action.EditProject)
  expect(ids).toContain(tracker.action.EditWorkflowStatuses)

  await openSpaceEditor(client, projected, click)

  expect(client.findOne).toHaveBeenCalledWith(full._class, { _id: full._id }, { showArchived: true })
  expect(editProject).toHaveBeenCalledWith(full, click, {})
  expect(deleteProject).not.toHaveBeenCalled()
  expect(editWorkflowStatuses).not.toHaveBeenCalled()
  expect(showPanel).not.toHaveBeenCalled()
})

it.each([
  [false, tracker.action.DeleteProject],
  [true, tracker.action.DeleteProjectClean]
])('opens nothing when only a competing action is permitted (archived=%s)', async (archived, competitor) => {
  const full = project(archived, false)
  const client = createClient(full, archived)
  const ids = (await getActions(client, full)).map((action) => action._id)
  expect(ids).toContain(competitor)
  expect(ids).not.toContain(tracker.action.EditProject)

  await openSpaceEditor(client, full, click)

  expect(editProject).not.toHaveBeenCalled()
  expect(deleteProject).not.toHaveBeenCalled()
  expect(editWorkflowStatuses).not.toHaveBeenCalled()
  expect(showPanel).not.toHaveBeenCalled()
})

it('opens the channel panel registered in the model for a space owner', async () => {
  const full = channel(true)

  await openSpaceEditor(createClient(full), full, click)

  expect(showPanel).toHaveBeenCalledWith(chunter.component.EditChannel, full._id, full._class, 'content')
})

it('does not open the channel editor without permission', async () => {
  const full = channel(false)

  await openSpaceEditor(createClient(full), full, click)

  expect(showPanel).not.toHaveBeenCalled()
})

it('opens the generic editor for a permitted space without its own editor', async () => {
  const full = { ...channel(true), _class: core.class.Space }

  await openSpaceEditor(createClient(full), full, click)

  expect(showPanel).toHaveBeenCalledWith(view.component.EditDoc, full._id, full._class, 'content')
})

it('does not open the generic editor without permission', async () => {
  const full = { ...channel(false), _class: core.class.Space }

  await openSpaceEditor(createClient(full), full, click)

  expect(showPanel).not.toHaveBeenCalled()
})

it('does not open an editor when the projected space has been removed', async () => {
  await openSpaceEditor(createClient(undefined), channel(true), click)

  expect(showPanel).not.toHaveBeenCalled()
})

it.each(['lookup', 'action lookup', 'permission check', 'editor'])('reports %s failures', async (phase) => {
  const report = jest.fn()
  jest.spyOn(console, 'trace').mockImplementation(() => {})
  addEventListener(PlatformEvent, report)
  const full = project(false, true)
  const client = createClient(full)
  if (phase === 'lookup') {
    jest.mocked(client.findOne).mockRejectedValueOnce(editorError)
  } else if (phase === 'action lookup') {
    jest.spyOn(client, 'getModel').mockImplementationOnce(() => {
      throw editorError
    })
  } else if (phase === 'permission check') {
    jest.spyOn(model, 'findOne').mockRejectedValueOnce(editorError)
  } else {
    editProject.mockRejectedValueOnce(editorError)
  }

  try {
    await openSpaceEditor(client, full, click)
    expect(report).toHaveBeenCalledWith(
      PlatformEvent,
      expect.objectContaining({ params: { message: editorError.message } })
    )
    expect(showPanel).not.toHaveBeenCalled()
  } finally {
    removeEventListener(PlatformEvent, report)
    jest.restoreAllMocks()
  }
})
