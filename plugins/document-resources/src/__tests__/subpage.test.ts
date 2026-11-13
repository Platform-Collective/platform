// SPDX-License-Identifier: EPL-2.0

import { AccountRole, type Account, type Class, type Doc, type Ref } from '@hcengineering/core'
import { canCreateSubpage, findReferenceRanges, makeReferenceContent } from '../subpage'

const docClass = 'document:class:Document' as Ref<Class<Doc>>

interface FakeNode {
  name: string
  attrs?: Record<string, any>
  size: number
  pos: number
}

function fakeDoc (nodes: FakeNode[]): {
  descendants: (f: (node: any, pos: number) => boolean | undefined) => void
} {
  return {
    descendants: (f) => {
      for (const node of nodes) {
        f({ type: { name: node.name }, attrs: node.attrs ?? {}, nodeSize: node.size }, node.pos)
      }
    }
  }
}

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

describe('findReferenceRanges', () => {
  it('finds only references to the given object, last first', () => {
    const doc = fakeDoc([
      { name: 'paragraph', size: 10, pos: 0 },
      { name: 'reference', attrs: { id: 'doc-1' }, size: 1, pos: 2 },
      { name: 'reference', attrs: { id: 'doc-2' }, size: 1, pos: 4 },
      { name: 'text', size: 3, pos: 5 },
      { name: 'reference', attrs: { id: 'doc-1' }, size: 1, pos: 8 }
    ])
    expect(findReferenceRanges(doc, 'doc-1' as Ref<Doc>)).toEqual([
      { from: 8, to: 9 },
      { from: 2, to: 3 }
    ])
  })

  it('returns nothing when the object is not referenced', () => {
    const doc = fakeDoc([{ name: 'reference', attrs: { id: 'doc-2' }, size: 1, pos: 1 }])
    expect(findReferenceRanges(doc, 'doc-1' as Ref<Doc>)).toEqual([])
  })
})

describe('canCreateSubpage', () => {
  it('allows workspace members', () => {
    expect(canCreateSubpage(account(AccountRole.User))).toBe(true)
    expect(canCreateSubpage(account(AccountRole.Maintainer))).toBe(true)
    expect(canCreateSubpage(account(AccountRole.Owner))).toBe(true)
  })

  it('does not allow guests', () => {
    expect(canCreateSubpage(account(AccountRole.Guest))).toBe(false)
    expect(canCreateSubpage(account(AccountRole.DocGuest))).toBe(false)
    expect(canCreateSubpage(account(AccountRole.ReadOnlyGuest))).toBe(false)
  })
})
