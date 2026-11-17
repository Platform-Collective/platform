// SPDX-License-Identifier: EPL-2.0

import { Schema, type Node } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'

import { getLoadingState, LoadingStatePlugin, loadingStatePluginKey, type LoadingStateTxMeta } from './toolbar'

jest.mock('@hcengineering/core', () => ({ notEmpty: (value: unknown) => value != null }))
jest.mock('@hcengineering/ui', () => ({ DebouncedCaller: jest.fn() }))
jest.mock('tippy.js', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../node-view', () => ({ SvelteRenderer: jest.fn() }))
jest.mock('./EditorToolbar.svelte', () => ({}))

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    image: { group: 'block', atom: true },
    text: { group: 'inline' }
  }
})

// <p>ab</p><image/><p>c</p>: the image starts at position 4.
const imagePos = 4

function createDoc (): Node {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text('ab')),
    schema.nodes.image.create(),
    schema.nodes.paragraph.create(null, schema.text('c'))
  ])
}

function createLoadingState (): EditorState {
  const state = EditorState.create({ doc: createDoc(), plugins: [LoadingStatePlugin()] })
  const meta: LoadingStateTxMeta = { setLoading: { pos: imagePos, loading: true } }
  return state.apply(state.tr.setMeta(loadingStatePluginKey, meta))
}

function loadingNodes (state: EditorState): number[] {
  return Array.from(getLoadingState(state)?.loadingNodes ?? [])
}

describe('LoadingStatePlugin', () => {
  it('maps a loading entry through edits before the node', () => {
    const state = createLoadingState()
    const next = state.apply(state.tr.insertText('x', 1))

    expect(loadingNodes(next)).toEqual([imagePos + 1])
    expect(next.doc.nodeAt(imagePos + 1)?.type.name).toBe('image')
  })

  it('keeps following the node when content is inserted right before it', () => {
    const state = createLoadingState()
    const paragraph = schema.nodes.paragraph.create(null, schema.text('new'))
    const next = state.apply(state.tr.insert(imagePos, paragraph))

    const expected = imagePos + paragraph.nodeSize
    expect(loadingNodes(next)).toEqual([expected])
    expect(next.doc.nodeAt(expected)?.type.name).toBe('image')
  })

  it('drops the loading entry when the node is deleted', () => {
    const state = createLoadingState()
    const next = state.apply(state.tr.delete(imagePos, imagePos + 1))

    expect(loadingNodes(next)).toEqual([])
  })
})
