// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import core from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import serverCore from '@hcengineering/server-core'

import { createModel } from '..'

describe('channel search presenter', () => {
  it('gives channels a search title so full-text mention search can return them', () => {
    const mixins: Array<{ target: unknown, mixin: unknown, attributes: unknown }> = []
    const builder = {
      mixin: (target: unknown, _class: unknown, mixin: unknown, attributes: unknown) => {
        if (_class === core.class.Class) mixins.push({ target, mixin, attributes })
      },
      createDoc: () => {}
    } as unknown as Builder

    createModel(builder)

    expect(mixins).toContainEqual({
      target: chunter.class.Channel,
      mixin: serverCore.mixin.SearchPresenter,
      attributes: { searchIcon: chunter.icon.Hashtag, title: [['name']] }
    })
  })
})
