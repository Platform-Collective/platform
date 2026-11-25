// SPDX-License-Identifier: EPL-2.0

import { AccountRole, type Account, type Class, type Doc, type Ref } from '@hcengineering/core'
import { canCreateSubpage, makeReferenceContent } from '../subpage'

const docClass = 'document:class:Document' as Ref<Class<Doc>>

function account (role: AccountRole): Account {
  return { uuid: 'account-uuid', role } as unknown as Account
}

describe('makeReferenceContent', () => {
  it('builds a reference node followed by a space', () => {
    expect(makeReferenceContent('doc-1' as Ref<Doc>, docClass, 'Untitled')).toEqual([
      { type: 'reference', attrs: { id: 'doc-1', objectclass: docClass, label: 'Untitled' } },
      { type: 'text', text: ' ' }
    ])
  })

  it('wraps the link into a paragraph when inserted between blocks', () => {
    expect(makeReferenceContent('doc-1' as Ref<Doc>, docClass, 'Untitled', false)).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'reference', attrs: { id: 'doc-1', objectclass: docClass, label: 'Untitled' } },
          { type: 'text', text: ' ' }
        ]
      }
    ])
  })
})

describe('canCreateSubpage', () => {
  it('rejects a user whose document creation permission forbids creation', () => {
    expect(canCreateSubpage(account(AccountRole.User), false)).toBe(false)
  })

  it('allows the same workspace roles as the navigator without requiring teamspace membership', () => {
    expect(canCreateSubpage(account(AccountRole.User), true)).toBe(true)
    expect(canCreateSubpage(account(AccountRole.Maintainer), true)).toBe(true)
    expect(canCreateSubpage(account(AccountRole.Owner), true)).toBe(true)
  })

  it('does not allow guests', () => {
    expect(canCreateSubpage(account(AccountRole.Guest), true)).toBe(false)
    expect(canCreateSubpage(account(AccountRole.DocGuest), true)).toBe(false)
    expect(canCreateSubpage(account(AccountRole.ReadOnlyGuest), true)).toBe(false)
  })
})
