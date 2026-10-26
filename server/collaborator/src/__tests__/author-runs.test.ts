// SPDX-License-Identifier: EPL-2.0

import { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector, UndoManager, XmlElement, XmlText } from 'yjs'
import type { AccountUuid } from '@hcengineering/core'
import type { Context } from '../context'
import { AuthorRuns } from '../extensions/author-runs'
import { MarkupTransformer } from '../transformers/markup'

const author = (account: string, connectionId = account): Context =>
  ({ account: account as AccountUuid, connectionId }) as unknown as Context

const A = author('A')
const B = author('B')

describe('author runs', () => {
  it.each([false, true])('preserves 40 alternating runs with gc:%s and ignores no-op sync', (gc) => {
    const doc = new Doc({ gc })
    const getMarkup = (): Record<string, string> => ({ content: doc.getText('content').toString() })
    const runs = new AuthorRuns(doc, getMarkup)
    const baseline = getMarkup()
    for (let i = 0; i < 40; i++) {
      const context = i % 2 === 0 ? A : B
      doc.transact(
        () => {
          doc.getText('content').insert(i, 'x')
        },
        { context }
      )
      applyUpdate(doc, encodeStateAsUpdate(doc, encodeStateVector(doc)), { context: author('C') })
      applyUpdate(doc, encodeStateAsUpdate(doc), { context: author('C') })
    }
    const segments = runs.drain(baseline, getMarkup())
    expect(segments).toHaveLength(40)
    segments.forEach((segment, index) => {
      expect(segment.context).toBe(index % 2 === 0 ? A : B)
      expect(segment.prev.content).toBe('x'.repeat(index))
      expect(segment.curr.content).toBe('x'.repeat(index + 1))
      if (index > 0) expect(segment.timestamp).toBeGreaterThan(segments[index - 1].timestamp)
    })
    runs.destroy()
    doc.destroy()
  })

  it('combines tabs of the same account and retains the baseline after a drain', () => {
    const doc = new Doc()
    const getMarkup = (): Record<string, string> => ({ content: doc.getText('content').toString() })
    const runs = new AuthorRuns(doc, getMarkup)
    doc.transact(
      () => {
        doc.getText('content').insert(0, 'a')
      },
      { context: A }
    )
    doc.transact(
      () => {
        doc.getText('content').insert(1, 'b')
      },
      { context: author('A', 'tab2') }
    )
    const first = runs.drain({ content: '' }, getMarkup())
    expect(first).toHaveLength(1)
    expect(first[0].curr.content).toBe('ab')
    doc.transact(
      () => {
        doc.getText('content').delete(0, 1)
      },
      { context: B }
    )
    expect(runs.drain(first[0].curr, getMarkup())[0]).toMatchObject({
      context: B,
      prev: { content: 'ab' },
      curr: { content: 'b' }
    })
    runs.destroy()
    doc.transact(
      () => {
        doc.getText('content').insert(0, 'ignored')
      },
      { context: A }
    )
    expect(runs.drain({}, getMarkup())).toEqual([])
    doc.destroy()
  })

  it('captures deletion, formatting and undo as exact markup boundaries without generating extra updates', () => {
    const doc = new Doc({ gc: false })
    const paragraph = new XmlElement('paragraph')
    const text = new XmlText()
    paragraph.insert(0, [text])
    doc.getXmlFragment('content').insert(0, [paragraph])
    const transformer = new MarkupTransformer()
    const getMarkup = (): Record<string, string> => transformer.fromYdoc(doc)
    const baseline = getMarkup()
    const runs = new AuthorRuns(doc, getMarkup)
    const originA = { context: A }
    const originB = { context: B }
    const undo = new UndoManager(text, { trackedOrigins: new Set([originB]) })
    // UndoManager is the transaction origin for undo; bind it to the authenticated caller,
    // just as incoming client updates arrive with their Connection as origin.
    Object.assign(undo, { context: B })
    const updates = jest.fn()
    doc.on('update', updates)
    doc.transact(() => {
      text.insert(0, 'hello')
    }, originA)
    const inserted = getMarkup()
    doc.transact(() => {
      text.format(0, 5, { bold: {} })
    }, originB)
    const formatted = getMarkup()
    undo.undo()
    const undone = getMarkup()
    doc.transact(() => {
      text.delete(0, 5)
    }, originA)
    const deleted = getMarkup()
    expect(runs.drain(baseline, deleted).map(({ prev, curr, context }) => [context.account, prev, curr])).toEqual([
      ['A', baseline, inserted],
      ['B', inserted, undone],
      ['A', undone, deleted]
    ])
    expect(formatted).not.toEqual(inserted)
    expect(undone).toEqual(inserted)
    expect(deleted).toEqual(baseline)
    expect(updates).toHaveBeenCalledTimes(4)
    undo.destroy()
    runs.destroy()
    doc.destroy()
  })

  it('ignores origins without authenticated context', () => {
    const doc = new Doc()
    const runs = new AuthorRuns(doc, () => ({}))
    doc.getText('content').insert(0, 'system')
    expect(runs.drain({}, {})).toEqual([])
    runs.destroy()
    doc.destroy()
  })
})

it('attributes merged reconnect and buffered dependent updates to the authenticated submitting connection', () => {
  const source = new Doc()
  source.getText('content').insert(0, 'a')
  const first = encodeStateAsUpdate(source)
  const vector = encodeStateVector(source)
  source.getText('content').insert(1, 'b')
  const second = encodeStateAsUpdate(source, vector)
  const server = new Doc()
  const getMarkup = (): Record<string, string> => ({ content: server.getText('content').toString() })
  const runs = new AuthorRuns(server, getMarkup)
  applyUpdate(server, second, { context: B }) // Missing dependencies: no applied edit yet.
  expect(runs.drain({ content: '' }, getMarkup())).toEqual([])
  applyUpdate(server, first, { context: A }) // Both edits become visible in this transaction.
  expect(runs.drain({ content: '' }, getMarkup()).map(({ context, curr }) => [context.account, curr.content])).toEqual([
    ['A', 'ab']
  ])
  runs.destroy()
  server.destroy()

  const reconnect = new Doc()
  const reconnectedRuns = new AuthorRuns(reconnect, () => ({ content: reconnect.getText('content').toString() }))
  applyUpdate(reconnect, encodeStateAsUpdate(source), { context: B })
  expect(reconnectedRuns.drain({ content: '' }, { content: 'ab' })[0].context).toBe(B)
  reconnectedRuns.destroy()
  reconnect.destroy()
  source.destroy()
})

it('contains failed boundary captures without stranding Yjs transactions and resumes tracking', () => {
  const doc = new Doc()
  const getMarkup = jest.fn(() => ({ content: doc.getText('content').toString() }))
  const warn = jest.fn()
  const runs = new AuthorRuns(doc, getMarkup, warn)
  const updates = jest.fn()
  doc.on('update', updates)
  const edit = (context: Context, value: string): void => {
    doc.transact(
      () => {
        doc.getText('content').insert(doc.getText('content').length, value)
      },
      { context }
    )
  }
  edit(A, 'a')
  getMarkup.mockImplementationOnce(() => {
    throw new Error('unsupported shared type')
  })
  expect(() => {
    edit(B, 'b')
  }).not.toThrow()
  getMarkup.mockImplementationOnce(() => {
    throw new Error('unsupported shared type')
  })
  expect(() => {
    edit(B, 'c')
  }).not.toThrow()
  edit(B, 'd')
  edit(A, 'e')
  expect(updates).toHaveBeenCalledTimes(5)
  expect(warn).toHaveBeenCalledTimes(1)
  const segments = runs.drain({ content: '' }, getMarkup())
  expect(segments.map(({ context, prev, curr }) => [context.account, prev.content, curr.content])).toEqual([
    ['A', '', 'abc'],
    ['B', 'abc', 'abcd'],
    ['A', 'abcd', 'abcde']
  ])
  runs.destroy()
  doc.destroy()
})
