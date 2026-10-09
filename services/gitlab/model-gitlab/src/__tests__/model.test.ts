// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { Builder } from '@hcengineering/model'
import activity from '@hcengineering/activity'
import core from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import { createModel } from '..'

describe('gitlab model', () => {
  it('keeps the hidden merge request diff out of activity', () => {
    const builder = new Builder()
    createModel(builder)
    const mixins = builder
      .getTxes()
      .filter((tx: any) => tx.objectId === gitlab.class.GitlabPatch && tx.objectClass === core.class.Class)
    expect(mixins.map((tx: any) => tx.mixin)).toContain(activity.mixin.IgnoreActivity)
  })
})
