/**
 * @jest-environment jsdom
 */
// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/presentation'
import { captureEditorPosition } from '@hcengineering/text-editor-resources'
import { addNotification } from '@hcengineering/ui'
import { openDoc } from '@hcengineering/view-resources'
import type { Document } from '@hcengineering/document'
import { Editor, Node } from '@tiptap/core'
import { createSubpage } from '../utils'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/text-editor-resources', () => ({
  captureEditorPosition: jest.fn(
    jest.requireActual('@hcengineering/text-editor-resources/src/components/extension/relativePosition')
      .captureEditorPosition
  )
}))
jest.mock('@hcengineering/ui', () => ({
  addNotification: jest.fn(),
  NotificationSeverity: { Warning: 'warning' }
}))
jest.mock('@hcengineering/view-resources', () => ({ openDoc: jest.fn(), accessDeniedStore: { set: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async (key: string, params: Record<string, string>) =>
    key === 'document:string:SubpageLinkFailed'
      ? `Subpage "${params.title}" was created, but its link could not be inserted. Find it in the navigator.`
      : 'Untitled'
  )
}))

const DocumentNode = Node.create({ name: 'doc', topNode: true, content: 'paragraph+' })
const ParagraphNode = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML () {
    return [{ tag: 'p' }]
  },
  renderHTML () {
    return ['p', 0]
  }
})
const TextNode = Node.create({ name: 'text', group: 'inline' })
const ReferenceNode = Node.create({
  name: 'reference',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes () {
    return { id: {}, objectclass: {}, label: {} }
  },
  parseHTML () {
    return [{ tag: 'span[data-type="reference"]' }]
  },
  renderHTML () {
    return ['span', { 'data-type': 'reference' }]
  }
})

let editors: Editor[] = []

function makeParent (): Document {
  return Object.assign(Object.create(null), { _id: 'parent', space: 'teamspace' })
}

function makeChild (): Document {
  return Object.assign(Object.create(null), { _id: 'child', title: 'Child title' })
}

function makeEditor (includeReference = true): Editor {
  const editor = new Editor({
    extensions: [DocumentNode, ParagraphNode, TextNode, ...(includeReference ? [ReferenceNode] : [])],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'existing' }] }]
    },
    injectCSS: false,
    enableContentCheck: !includeReference
  })
  editors.push(editor)
  return editor
}

function makeClient (child: Document = makeChild()): {
  findAll: jest.Mock
  createDoc: jest.Mock
  findOne: jest.Mock
  getHierarchy: jest.Mock
} {
  return {
    findAll: jest.fn(async () => []),
    createDoc: jest.fn(async () => {}),
    findOne: jest.fn(async () => child),
    getHierarchy: jest.fn(() => ({}))
  }
}

function referenceAttributes (editor: Editor): unknown[] {
  const references: unknown[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'reference') references.push(node.attrs)
  })
  return references
}

function expectLinkFailure (editor: Editor): void {
  expect(referenceAttributes(editor)).toEqual([])
  expect(openDoc).not.toHaveBeenCalled()
  expect(addNotification).toHaveBeenCalledWith(
    'Subpage "Child title" was created, but its link could not be inserted. Find it in the navigator.',
    '',
    undefined,
    undefined,
    'warning'
  )
}

describe('subpage creation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(captureEditorPosition as jest.Mock).mockImplementation(
      jest.requireActual('@hcengineering/text-editor-resources/src/components/extension/relativePosition')
        .captureEditorPosition
    )
    editors = []
  })

  afterEach(() => {
    for (const editor of editors) editor.destroy()
  })

  it('creates the document before inserting its link and navigates after the real transaction succeeds', async () => {
    let finishCreation: () => void = () => {}
    const pendingCreation = new Promise<void>((resolve) => {
      finishCreation = resolve
    })
    const child = makeChild()
    const client = makeClient(child)
    client.createDoc.mockImplementation(async () => {
      await pendingCreation
    })
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    const creation = createSubpage(editor, 2, makeParent())
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(captureEditorPosition).toHaveBeenCalledWith(editor, 2)
    expect(client.createDoc).toHaveBeenCalledTimes(1)
    expect(referenceAttributes(editor)).toEqual([])

    finishCreation()
    await creation
    expect(referenceAttributes(editor)).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        objectclass: 'document:class:Document',
        label: 'Untitled'
      })
    ])
    expect(openDoc).toHaveBeenCalledWith({}, child)
    expect(addNotification).not.toHaveBeenCalled()
  })

  it('does not insert a link or navigate when document creation fails', async () => {
    const client = makeClient()
    client.createDoc.mockRejectedValue(new Error('creation failed'))
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    expect(referenceAttributes(editor)).toEqual([])
    expect(openDoc).not.toHaveBeenCalled()
  })

  it('keeps navigation closed and identifies the child when the position cannot be resolved', async () => {
    ;(captureEditorPosition as jest.Mock).mockReturnValue(() => null)
    const client = makeClient()
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    expectLinkFailure(editor)
  })

  it('keeps navigation closed and identifies the child when the real command chain fails', async () => {
    const client = makeClient()
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor(false)

    await createSubpage(editor, 2, makeParent())
    expectLinkFailure(editor)
  })

  it('keeps navigation closed and identifies the child when the editor was destroyed', async () => {
    const client = makeClient()
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()
    editor.destroy()

    await createSubpage(editor, 2, makeParent())
    expectLinkFailure(editor)
  })
})
