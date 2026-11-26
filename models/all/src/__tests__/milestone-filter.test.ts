// SPDX-License-Identifier: EPL-2.0

import core, { type AnyAttribute, Hierarchy, MeasureMetricsContext, ModelDb } from '@hcengineering/core'
import tracker from '@hcengineering/model-tracker'
import view from '@hcengineering/model-view'
import buildModel from '..'

describe('milestone filter model', () => {
  const hierarchy = new Hierarchy()
  const model = new ModelDb(hierarchy)
  model.addTxes(new MeasureMetricsContext('test', {}), buildModel().getTxes(), false)

  it('names the project of each milestone in the Issue milestone filter', () => {
    const attribute = hierarchy.getAttribute(tracker.class.Issue, 'milestone')
    const modelAttribute = model.findObject<AnyAttribute>(attribute._id)

    expect(modelAttribute?._class).toBe(core.class.Attribute)
    expect(hierarchy.hasMixin(modelAttribute as AnyAttribute, view.mixin.ReferenceFilterSpace)).toBe(true)
    const config = hierarchy.as(modelAttribute as AnyAttribute, view.mixin.ReferenceFilterSpace)
    expect(config.spaceClass).toBe(tracker.class.Project)
    expect(config.labelKey).toBe('identifier')
  })

  it('leaves other reference filters unchanged', () => {
    const component = model.findObject<AnyAttribute>(hierarchy.getAttribute(tracker.class.Issue, 'component')._id)
    expect(hierarchy.hasMixin(component as AnyAttribute, view.mixin.ReferenceFilterSpace)).toBe(false)
  })
})
