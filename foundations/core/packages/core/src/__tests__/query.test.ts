//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { findProperty, isSameLink } from '../query'
import type { Doc, Ref, Class } from '../classes'

function doc (id: string, fields: Record<string, any> = {}): Doc {
  const doc: Doc = { _id: id as Ref<Doc>, _class: 'test:class:Issue' as Ref<Class<Doc>>, ...fields } as any
  return doc
}

describe('findProperty', () => {
  const assigned1 = doc('i1', { assignee: 'person:1' })
  const assigned2 = doc('i2', { assignee: 'person:2' })
  const unassigned = doc('i3', { assignee: null })
  const missingField = doc('i4')
  const allDocs = [assigned1, assigned2, unassigned, missingField]

  it('should match a specific value', () => {
    const result = findProperty(allDocs, 'assignee', 'person:1')
    expect(result).toEqual([assigned1])
  })

  it('should match null to docs with null or missing field', () => {
    const result = findProperty(allDocs, 'assignee', null)
    expect(result).toEqual([unassigned, missingField])
  })

  it('should match undefined to docs with null or missing field', () => {
    const result = findProperty(allDocs, 'assignee', undefined)
    expect(result).toEqual([unassigned, missingField])
  })

  describe('JSON round-trip (simulates server query)', () => {
    it('null survives JSON serialization and filters correctly', () => {
      const query = { assignee: null }
      const roundTripped = JSON.parse(JSON.stringify(query))
      expect(roundTripped).toHaveProperty('assignee')

      const result = findProperty(allDocs, 'assignee', roundTripped.assignee)
      expect(result).toEqual([unassigned, missingField])
    })

    it('undefined is stripped by JSON serialization, losing the filter', () => {
      const query = { assignee: undefined }
      const roundTripped = JSON.parse(JSON.stringify(query))
      expect(roundTripped).not.toHaveProperty('assignee')

      // Without the 'assignee' key, matchQuery iterates only the remaining keys
      // and never calls findProperty for assignee, so all docs pass through.
      // This is the root cause of #10606.
    })
  })
})

describe('findProperty over a list of links', () => {
  // Query values are separate copies of the stored links, as after a round trip to the server.
  const link = (id: string): any => ({ _id: id, _class: 'test:class:Issue' })
  const both = doc('l1', { blockedBy: [link('a'), link('b')] })
  const onlyA = doc('l2', { blockedBy: [link('a')] })
  const reordered = doc('l3', { blockedBy: [{ _class: 'test:class:Issue', _id: 'b' }] })
  const none = doc('l4', { blockedBy: [] })
  const missing = doc('l5')
  const allDocs = [both, onlyA, reordered, none, missing]
  const ids = (docs: Doc[]): string[] => docs.map((it) => it._id)

  it('matches $in by link content', () => {
    expect(ids(findProperty(allDocs, 'blockedBy', { $in: [link('b')] }))).toEqual(['l1', 'l3'])
    expect(ids(findProperty(allDocs, 'blockedBy', { $in: [link('a'), link('b')] }))).toEqual(['l1', 'l2', 'l3'])
  })

  it('matches $all by link content', () => {
    expect(ids(findProperty(allDocs, 'blockedBy', { $all: [link('a'), link('b')] }))).toEqual(['l1'])
    expect(ids(findProperty(allDocs, 'blockedBy', { $all: [link('a')] }))).toEqual(['l1', 'l2'])
  })

  it('matches $nin by link content', () => {
    expect(ids(findProperty(allDocs, 'blockedBy', { $nin: [link('a')] }))).toEqual(['l3', 'l4', 'l5'])
  })

  it('matches a single link by content', () => {
    expect(ids(findProperty(allDocs, 'blockedBy', link('a')))).toEqual(['l1', 'l2'])
  })

  it('matches link-list items by _id and _class only', () => {
    const extra = doc('l6', { blockedBy: [{ ...link('a'), title: 'extra' }] })
    const otherClass = doc('l7', { blockedBy: [{ _id: 'a', _class: 'test:class:Other' }] })
    const docs = [...allDocs, extra, otherClass]
    expect(ids(findProperty(docs, 'blockedBy', { $in: [link('a')] }, isSameLink))).toEqual(['l1', 'l2', 'l6'])
    expect(ids(findProperty(docs, 'blockedBy', { $all: [link('a')] }, isSameLink))).toEqual(['l1', 'l2', 'l6'])
    expect(ids(findProperty(docs, 'blockedBy', { $nin: [link('a')] }, isSameLink))).toEqual(['l3', 'l4', 'l5', 'l7'])
    expect(ids(findProperty(docs, 'blockedBy', link('a'), isSameLink))).toEqual(['l1', 'l2', 'l6'])
    // Extra fields in the query link are ignored too.
    expect(ids(findProperty(docs, 'blockedBy', { $in: [{ ...link('a'), title: 'x' }] }, isSameLink))).toEqual([
      'l1',
      'l2',
      'l6'
    ])
  })

  it('keeps literal object matching for other lists', () => {
    const extra = doc('l6', { blockedBy: [{ ...link('a'), title: 'extra' }] })
    expect(ids(findProperty([...allDocs, extra], 'blockedBy', { $in: [link('a')] }))).toEqual(['l1', 'l2'])
  })

  it('matches null operands against a missing field, a null field and a null item', () => {
    const nullField = doc('l6', { blockedBy: null })
    const nullItem = doc('l7', { blockedBy: [null] })
    const docs = [...allDocs, nullField, nullItem]
    expect(ids(findProperty(docs, 'blockedBy', { $in: [link('a'), null] }, isSameLink))).toEqual([
      'l1',
      'l2',
      'l5',
      'l6',
      'l7'
    ])
    expect(ids(findProperty(docs, 'blockedBy', { $nin: [link('a'), null] }, isSameLink))).toEqual(['l3', 'l4'])
    // $all: [] matches every list.
    expect(ids(findProperty(docs, 'blockedBy', { $all: [] }, isSameLink))).toEqual(['l1', 'l2', 'l3', 'l4', 'l7'])
  })
})
