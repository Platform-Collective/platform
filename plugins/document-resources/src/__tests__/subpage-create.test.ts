/**
 * @jest-environment jsdom
 */
// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import core, {
  type Client,
  Hierarchy,
  systemAccount,
  type Tx,
  type TxCreateDoc,
  type TxResult,
  TxOperations
} from '@hcengineering/core'
import { documentId, type Document } from '@hcengineering/document'
import { addStringsLoader } from '@hcengineering/platform'
import { getClient, PresentationPipelineImpl } from '@hcengineering/presentation'
import { captureEditorPosition } from '@hcengineering/text-editor-resources'
import { Notifications } from '@hcengineering/ui'
import { openDoc } from '@hcengineering/view-resources'
import { Editor, Node } from '@tiptap/core'
import { tick } from 'svelte'
import { createSubpage } from '../utils'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/presentation', () => ({
  PresentationPipelineImpl: jest.requireActual('@hcengineering/presentation/src/pipeline').PresentationPipelineImpl,
  getClient: jest.fn()
}))
jest.mock('@hcengineering/text-editor-resources', () => ({
  captureEditorPosition: jest.fn()
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
const { captureEditorPosition: actualCaptureEditorPosition } = jest.requireActual<{
  captureEditorPosition: typeof captureEditorPosition
}>('@hcengineering/text-editor-resources/src/components/extension/relativePosition')

const { ReferenceNode } = jest.requireActual<{ ReferenceNode: Node }>(
  '../../../../foundations/core/packages/text/src/nodes/reference'
)

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
    enableContentCheck: !includeReference,
    onContentError: () => {}
  })
  editors.push(editor)
  return editor
}

function makeTransport (child: Document = makeChild()): {
  tx: jest.Mock<Promise<TxResult>, [Tx]>
  findOne: jest.Mock<Promise<Document | undefined>>
  getHierarchy: () => Hierarchy
} {
  const hierarchy = new Hierarchy()
  return {
    tx: jest.fn<Promise<TxResult>, [Tx]>(async () => ({})),
    findOne: jest.fn(async (): Promise<Document | undefined> => child).mockResolvedValueOnce(undefined),
    getHierarchy: () => hierarchy
  }
}

function useClient (transport: ReturnType<typeof makeTransport>, usePipeline = true): void {
  // Only the client transport is stubbed. The operations and pipeline execute their real transaction code.
  const client = transport as unknown as Client
  const pipeline = usePipeline ? PresentationPipelineImpl.create(client, []) : client
  jest.mocked(getClient).mockReturnValue(new TxOperations(pipeline, systemAccount.primarySocialId))
}

function referenceAttributes (editor: Editor): unknown[] {
  const references: unknown[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'reference') references.push(node.attrs)
  })
  return references
}

function expectWarning (editor: Editor, message: string): void {
  expect(referenceAttributes(editor)).toEqual([])
  expect(openDoc).not.toHaveBeenCalled()
  expect(target.querySelector('.icon-warning')).not.toBeNull()
  expect(target.querySelector('.content')?.textContent?.trim()).toBe(message)
}

const LINK_FAILURE = 'Subpage "Child title" was created, but its link could not be inserted. Find it in the navigator.'
const CREATION_UNCONFIRMED = 'Subpage creation could not be confirmed.'

describe('subpage creation', () => {
  beforeAll(() => {
    addStringsLoader(documentId, async () =>
      jest.requireActual<Record<string, Record<string, string>>>('../../../document-assets/lang/en.json')
    )
  })

  beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(captureEditorPosition).mockImplementation(actualCaptureEditorPosition)
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
    const transport = makeTransport(child)
    transport.tx.mockImplementation(async (tx) => {
      child._id = (tx as TxCreateDoc<Document>).objectId
      startCreation()
      await pendingCreation
      return {}
    })
    useClient(transport)
    const editor = makeEditor()

    const creation = createSubpage(editor, 2, makeParent())
    await startedCreation
    expect(captureEditorPosition).toHaveBeenCalledWith(editor, 2)
    expect(transport.tx).toHaveBeenCalledTimes(1)
    expect(referenceAttributes(editor)).toEqual([])
    expect(openDoc).not.toHaveBeenCalled()

    const attributes = [
      expect.objectContaining({
        id: child._id,
        objectclass: 'document:class:Document',
        label: 'Untitled'
      })
    ]
    jest.mocked(openDoc).mockImplementation(async () => {
      expect(referenceAttributes(editor)).toEqual(attributes)
    })

    finishCreation()
    await creation
    const tx = transport.tx.mock.calls[0][0]
    expect(tx).toMatchObject({ _class: core.class.TxCreateDoc })
    expect(transport.findOne).toHaveBeenLastCalledWith('document:class:Document', { _id: child._id }, undefined)
    expect(referenceAttributes(editor)).toEqual(attributes)
    expect(openDoc).toHaveBeenCalledTimes(1)
    expect(openDoc).toHaveBeenCalledWith(transport.getHierarchy(), child)
    expect(target.textContent?.trim()).toBe('')
  })

  it('warns that creation is unconfirmed when the write throws directly', async () => {
    const transport = makeTransport()
    transport.tx.mockRejectedValue(new Error('creation failed'))
    useClient(transport, false)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    await tick()
    expect(transport.findOne).toHaveBeenCalledTimes(1)
    expectWarning(editor, CREATION_UNCONFIRMED)
  })

  it('keeps navigation closed and identifies the child when the position cannot be resolved', async () => {
    jest.mocked(captureEditorPosition).mockReturnValueOnce(() => null)
    const transport = makeTransport()
    useClient(transport)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    await tick()
    expectWarning(editor, LINK_FAILURE)
  })

  it('keeps navigation closed and identifies the child when the real command chain returns false', async () => {
    const transport = makeTransport()
    useClient(transport)
    const editor = makeEditor(false)
    const handleError = jest.spyOn(Analytics, 'handleError')

    await createSubpage(editor, 2, makeParent())
    await tick()
    expect(handleError).not.toHaveBeenCalled()
    expectWarning(editor, LINK_FAILURE)
  })

  it('keeps navigation closed and identifies the child when the editor was destroyed', async () => {
    const transport = makeTransport()
    useClient(transport)
    const editor = makeEditor()
    transport.tx.mockImplementationOnce(async () => {
      editor.destroy()
      return {}
    })

    await createSubpage(editor, 2, makeParent())
    await tick()
    expectWarning(editor, LINK_FAILURE)
  })

  it('warns that creation is unconfirmed when the pipeline converts a rejected write to an empty result', async () => {
    const transport = makeTransport()
    transport.tx.mockRejectedValue(new Error('write rejected'))
    transport.findOne.mockResolvedValue(undefined)
    useClient(transport)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    await tick()
    expect(transport.tx).toHaveBeenCalledTimes(1)
    expect(transport.findOne).toHaveBeenCalledTimes(2)
    expectWarning(editor, CREATION_UNCONFIRMED)
  })

  it('warns that creation is unconfirmed when reading the child throws', async () => {
    const transport = makeTransport()
    transport.findOne.mockRejectedValueOnce(new Error('read failed'))
    useClient(transport, false)
    const editor = makeEditor()

    await createSubpage(editor, 2, makeParent())
    await tick()
    expect(transport.tx).toHaveBeenCalledTimes(1)
    expect(transport.findOne).toHaveBeenCalledTimes(2)
    expectWarning(editor, CREATION_UNCONFIRMED)
  })
})
