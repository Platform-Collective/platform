// SPDX-License-Identifier: EPL-2.0
import core, { TxProcessor, type Doc, type TxCreateDoc } from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import { createModel as createCoreModel } from '@hcengineering/model-core'
import { createModel as createPreferenceModel } from '@hcengineering/model-preference'
import { createModel as createTaskModel } from '@hcengineering/model-task'
import view from '@hcengineering/model-view'
import type { Action } from '@hcengineering/view'
import tracker from '../plugin'
import { createModel } from '../index'

function trackerModel (): Builder {
  const builder = new Builder()
  createCoreModel(builder)
  createPreferenceModel(builder)
  createTaskModel(builder)
  createModel(builder)
  return builder
}

it('keeps the navigator preference private to the account', () => {
  const builder = trackerModel()
  expect(builder.hierarchy.getDomain(tracker.class.ProjectNavigatorPreference)).toBe('preference')
  expect(builder.hierarchy.getAttribute(tracker.class.ProjectNavigatorPreference, 'showProjectOwners')).toBeDefined()
})

it('offers show and hide of project owners in the project context menu', () => {
  const actions = trackerModel()
    .getTxes()
    .filter((tx) => tx._class === core.class.TxCreateDoc && (tx as TxCreateDoc<Doc>).objectClass === view.class.Action)
    .map((tx) => TxProcessor.createDoc2Doc(tx as TxCreateDoc<Action>))
  expect(actions.find((it) => it._id === tracker.action.HideProjectOwners)).toMatchObject({
    action: tracker.actionImpl.HideProjectOwners,
    target: tracker.class.Project,
    visibilityTester: tracker.function.CanHideProjectOwners,
    context: { mode: ['context'] }
  })
  expect(actions.find((it) => it._id === tracker.action.ShowProjectOwners)).toMatchObject({
    action: tracker.actionImpl.ShowProjectOwners,
    target: tracker.class.Project,
    visibilityTester: tracker.function.CanShowProjectOwners,
    context: { mode: ['context'] }
  })
})
