/**
 * @jest-environment jsdom
 */
// SPDX-License-Identifier: EPL-2.0

import { documentId, type Document } from '@hcengineering/document'
import { addStringsLoader } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { captureEditorPosition } from '@hcengineering/text-editor-resources'
import { Notifications } from '@hcengineering/ui'
import { openDoc } from '@hcengineering/view-resources'
import { Editor, Node } from '@tiptap/core'
import { tick } from 'svelte'
import { createSubpage } from '../utils'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/text-editor-resources', () => ({
  captureEditorPosition: jest.fn(
    jest.requireActual('@hcengineering/text-editor-resources/src/components/extension/relativePosition')
      .captureEditorPosition
  )
}))
// Load the real notification path without bootstrapping the application through the package barrels.
jest.mock('@hcengineering/ui', () => ({
  addNotification: jest.requireActual('@hcengineering/ui/src/utils').addNotification,
  deviceOptionsStore: jest.requireActual('svelte/store').readable({ size: null }),
  NotificationToast: jest.requireActual('@hcengineering/ui/src/components/NotificationToast.svelte').default,
  Notifications: jest.requireActual('@hcengineering/ui/src/components/notifications/Notifications.svelte').default,
  NotificationPosition: jest.requireActual('@hcengineering/ui/src/components/notifications/NotificationPosition')
    .NotificationPosition,
  NotificationSeverity: jest.requireActual('@hcengineering/ui/src/components/notifications/NotificationSeverity')
    .NotificationSeverity,
  notificationsStore: jest.requireActual('@hcengineering/ui/src/components/notifications/store').default
}))
jest.mock('@hcengineering/view-resources', () => ({
  SimpleNotification: jest.requireActual('@hcengineering/view-resources/src/components/SimpleNotification.svelte')
    .default,
  openDoc: jest.fn()
}))
jest.mock('@hcengineering/ui/src/components/RootStatusComponent.svelte', () => ({}))
jest.mock('@hcengineering/ui/src/components/Component.svelte', () => ({}))
jest.mock('@hcengineering/platform-rig/profiles/ui/svelte', () => ({}), { virtual: true })

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
let notifications: InstanceType<typeof Notifications>
let target: HTMLDivElement

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
  createDoc: jest.Mock
  findOne: jest.Mock
  getHierarchy: jest.Mock
} {
  return {
    createDoc: jest.fn(async () => {}),
    findOne: jest.fn(async (): Promise<Document | undefined> => child).mockResolvedValueOnce(undefined),
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

function expectLinkFailure (editor: Editor, title: string = 'Child title'): void {
  expect(referenceAttributes(editor)).toEqual([])
  expect(openDoc).not.toHaveBeenCalled()
  expect(target.querySelector('.icon-warning')).not.toBeNull()
  expect(target.querySelector('.content')?.textContent?.trim()).toBe(
    `Subpage "${title}" was created, but its link could not be inserted. Find it in the navigator.`
  )
}

describe('subpage creation', () => {
  beforeAll(() => {
    addStringsLoader(documentId, async () =>
      jest.requireActual<Record<string, Record<string, string>>>('../../../document-assets/lang/en.json')
    )
  })

  beforeEach(() => {
    jest.clearAllMocks()
    editors = []
    target = document.createElement('div')
    document.body.append(target)
    notifications = new Notifications({ target })
  })

  afterEach(() => {
    for (const editor of editors) editor.destroy()
    notifications.$destroy()
    target.remove()
  })

  it('creates the document before inserting its link and navigates after the real transaction succeeds', async () => {
    let finishCreation: () => void = () => {}
    let startCreation: () => void = () => {}
    const pendingCreation = new Promise<void>((resolve) => {
      finishCreation = resolve
    })
    const startedCreation = new Promise<void>((resolve) => {
      startCreation = resolve
    })
    const child = makeChild()
    const client = makeClient(child)
    client.createDoc.mockImplementation(async () => {
      startCreation()
      await pendingCreation
    })
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    const creation = createSubpage(editor, 2, makeParent())
    await startedCreation
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
    expect(target.textContent?.trim()).toBe('')
  })

  it('does not insert a link or navigate when document creation fails', async () => {
    const client = makeClient()
    client.createDoc.mockRejectedValue(new Error('creation failed'))
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    expect(referenceAttributes(editor)).toEqual([])
    expect(openDoc).not.toHaveBeenCalled()
    expect(target.textContent?.trim()).toBe('')
  })

  it('keeps navigation closed and identifies the child when the position cannot be resolved', async () => {
    jest.mocked(captureEditorPosition).mockReturnValueOnce(() => null)
    const client = makeClient()
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    await tick()
    expectLinkFailure(editor)
  })

  it('keeps navigation closed and identifies the child when the real command chain fails', async () => {
    const client = makeClient()
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor(false)

    await createSubpage(editor, 2, makeParent())
    await tick()
    expectLinkFailure(editor)
  })

  it('keeps navigation closed and identifies the child when the editor was destroyed', async () => {
    const client = makeClient()
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()
    client.createDoc.mockImplementationOnce(async () => {
      editor.destroy()
    })

    await createSubpage(editor, 2, makeParent())
    await tick()
    expectLinkFailure(editor)
  })

  it.each(['missing', 'failed'])('identifies the created child when the read is %s', async (read) => {
    const client = makeClient()
    if (read === 'missing') {
      client.findOne.mockResolvedValue(undefined)
    } else {
      client.findOne.mockRejectedValue(new Error('read failed'))
    }
    ;(getClient as jest.Mock).mockReturnValue(client)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    await tick()
    expect(client.createDoc).toHaveBeenCalledTimes(1)
    expectLinkFailure(editor, 'Untitled')
  })
})
