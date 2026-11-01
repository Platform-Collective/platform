// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import type { PersonId } from '@hcengineering/core'
import { getPersonIdPresenterState } from '../components/person-id-presenter'

describe('author presentation for CreatedBy and ModifiedBy', () => {
  const authorId = 'social-identity' as PersonId
  const systemId = 'core:account:System' as PersonId
  const person = { name: 'Author' } as unknown as Person

  it('keeps an existing author visible', () => {
    expect(getPersonIdPresenterState(authorId, person, systemId)).toBe('resolved')
  })

  it('shows loading while a populated author is being resolved', () => {
    expect(getPersonIdPresenterState(authorId, undefined, systemId)).toBe('loading')
  })

  it.each(['removed-person', 'unmapped-identity', 'automation'])('keeps %s visible as an unresolved author', (id) => {
    expect(getPersonIdPresenterState(id as PersonId, null, systemId)).toBe('unresolved')
  })

  it.each([undefined, null, person])('recognizes the system author independently of identity lookup (%s)', (result) => {
    expect(getPersonIdPresenterState(systemId, result, systemId)).toBe('system')
  })

  it.each([undefined, '' as PersonId])('keeps an absent author empty (%s)', (id) => {
    expect(getPersonIdPresenterState(id, undefined, systemId)).toBe('empty')
    expect(getPersonIdPresenterState(id, person, systemId)).toBe('empty')
  })
})
