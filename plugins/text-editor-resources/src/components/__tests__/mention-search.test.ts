// SPDX-License-Identifier: EPL-2.0

import { prependUniqueMentionResults } from '../mention-search'

describe('prependUniqueMentionResults', () => {
  it('keeps full-text results while prioritizing and deduplicating matching members', () => {
    const member = { id: 'member', title: 'Member' }
    const fullTextMember = { id: 'member', title: 'Member', iconComponent: 'avatar' }
    const issue = { id: 'issue', title: 'Issue', shortTitle: 'TSK-12' }
    const otherEmployee = { id: 'other-employee', title: 'Other employee' }

    expect(prependUniqueMentionResults([member], [issue, fullTextMember, otherEmployee])).toEqual([
      fullTextMember,
      issue,
      otherEmployee
    ])
  })
})
