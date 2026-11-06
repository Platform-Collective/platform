// SPDX-License-Identifier: EPL-2.0

import { getPanelLocation, PanelHistory } from '../card-panel-history'

describe('getPanelLocation', () => {
  it('gets the opened card type from a card panel fragment', () => {
    const panel = getPanelLocation(
      'card%3Acomponent%3AEditCard%7Ccard-b%7Ccard%3Aclass%3ATypeB%7Ccontent',
      'card:component:EditCard'
    )

    expect(panel).toEqual({
      fragment: 'card%3Acomponent%3AEditCard%7Ccard-b%7Ccard%3Aclass%3ATypeB%7Ccontent',
      _id: 'card-b',
      _class: 'card:class:TypeB'
    })
  })

  it('ignores panels that do not display cards', () => {
    const panel = getPanelLocation('view%3Acomponent%3AEditDoc%7Cdoc%7Cview%3Aclass%3ADoc', 'card:component:EditCard')

    expect(panel).toBeUndefined()
  })
})

describe('PanelHistory', () => {
  it('returns to the prior card panel in opening order', () => {
    const history = new PanelHistory()
    history.update('card-a')
    history.update('card-b')
    history.update('card-c')

    expect(history.back()).toBe('card-b')
    expect(history.back()).toBe('card-a')
    expect(history.back()).toBeUndefined()
  })

  it('does not reopen a later card after browser back', () => {
    const history = new PanelHistory()
    history.update('card-a')
    history.update('card-b')
    history.update('card-a')

    expect(history.back()).toBeUndefined()
  })

  it('clears the stack after leaving a card panel', () => {
    const history = new PanelHistory()
    history.update('card-a')
    history.update('card-b')
    history.update(undefined)

    expect(history.back()).toBeUndefined()
  })
})
