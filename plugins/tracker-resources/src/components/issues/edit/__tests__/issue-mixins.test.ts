// SPDX-License-Identifier: EPL-2.0

import { ClassifierKind } from '@hcengineering/core'
import type { Class, Doc, Mixin } from '@hcengineering/core'
import { getIssueMixins } from '../issue-mixins'

const taskTypeMixin = { _id: 'test:mixin:TaskType', kind: ClassifierKind.MIXIN } as unknown as Mixin<Doc>
const otherMixin = { _id: 'test:mixin:Other', kind: ClassifierKind.MIXIN } as unknown as Mixin<Doc>

describe('issue mixins', () => {
  it('includes a fresh task type mixin when the issue has no stored custom values', () => {
    expect(getIssueMixins([], taskTypeMixin)).toEqual([taskTypeMixin])
  })

  it('preserves existing mixins while adding the selected task type', () => {
    const existingMixins = [otherMixin]

    expect(getIssueMixins(existingMixins, taskTypeMixin)).toEqual([otherMixin, taskTypeMixin])
    expect(existingMixins).toEqual([otherMixin])
  })

  it('does not duplicate the task type mixin after its first value is stored or all mixins are shown', () => {
    expect(getIssueMixins([otherMixin, taskTypeMixin], taskTypeMixin)).toEqual([otherMixin, taskTypeMixin])
  })

  it('deduplicates mixins by id', () => {
    expect(getIssueMixins([otherMixin, { ...otherMixin }], taskTypeMixin)).toEqual([otherMixin, taskTypeMixin])
  })

  it('preserves existing mixins when the task type is unavailable', () => {
    expect(getIssueMixins([otherMixin])).toEqual([otherMixin])
  })

  it('does not treat a regular target class as a mixin', () => {
    const targetClass = { _id: 'test:class:Issue', kind: ClassifierKind.CLASS } as unknown as Class<Doc>

    expect(getIssueMixins([otherMixin], targetClass)).toEqual([otherMixin])
  })

  it('uses the newly selected task type when an issue changes kind', () => {
    expect(getIssueMixins([], taskTypeMixin)).toEqual([taskTypeMixin])
    expect(getIssueMixins([], otherMixin)).toEqual([otherMixin])
  })
})
