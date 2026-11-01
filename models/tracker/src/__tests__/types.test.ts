// SPDX-License-Identifier: EPL-2.0

import { Builder } from '@hcengineering/model'
import {
  addEventListener,
  addStringsLoader,
  PlatformEvent,
  removeEventListener,
  translate
} from '@hcengineering/platform'
import { trackerId } from '@hcengineering/tracker'

import tracker from '../plugin'
import { TMilestone, TypeMilestoneStatus } from '../types'

describe('Milestone status type', () => {
  it('keeps the milestone status type with a localized label', () => {
    expect(TypeMilestoneStatus()).toEqual({
      _class: tracker.class.TypeMilestoneStatus,
      label: tracker.string.Status
    })
  })

  it('translates the generated status attribute type label without a platform error', async () => {
    const builder = new Builder()
    builder.createModel(TMilestone)
    const attribute = builder.hierarchy.getAttribute(tracker.class.Milestone, 'status')
    const onStatus = jest.fn().mockResolvedValue(undefined)
    addStringsLoader(
      trackerId,
      async (locale) => await import(`../../../../plugins/tracker-assets/lang/${locale}.json`)
    )
    addEventListener(PlatformEvent, onStatus)

    try {
      expect(attribute.type._class).toBe(tracker.class.TypeMilestoneStatus)
      expect(await translate(attribute.type.label, {}, 'en')).toBe('Status')
      expect(onStatus).not.toHaveBeenCalled()
    } finally {
      removeEventListener(PlatformEvent, onStatus)
    }
  })
})
