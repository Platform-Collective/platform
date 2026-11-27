// SPDX-License-Identifier: EPL-2.0
import { Builder } from '@hcengineering/model'
import { createModel as createCoreModel } from '@hcengineering/model-core'
import { createModel as createPreferenceModel } from '@hcengineering/model-preference'
import { createModel as createTaskModel } from '@hcengineering/model-task'
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
