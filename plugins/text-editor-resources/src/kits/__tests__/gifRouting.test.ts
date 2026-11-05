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

// The composer's emoji action is a plain exported closure, not Svelte, so the routing it now
// performs is testable without a component harness. This matters more than it looks: the
// change modifies a path every existing emoji user hits many times a day, and until these
// tests existed CI covered none of it.

let captured: ((result: unknown) => void) | undefined

jest.mock('@hcengineering/ui', () => ({
  showPopup: (_component: unknown, _props: unknown, _element: unknown, onClose: (r: unknown) => void) => {
    captured = onClose
  }
}))

jest.mock('@hcengineering/presentation', () => ({
  getClient: () => ({ findAll: async () => [] })
}))

const handler = {
  insertEmoji: jest.fn(),
  insertGif: jest.fn(),
  insertText: jest.fn(),
  focus: jest.fn()
}

const openPicker = async (): Promise<void> => {
  const { defaultRefActions } = await import('../../components/editor/actions')
  const emojiAction = defaultRefActions.find((a) => a.order === 4001)
  expect(emojiAction).toBeDefined()
  emojiAction?.action(null as never, handler as never, undefined)
  expect(captured).toBeDefined()
}

describe('composer picker routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    captured = undefined
  })

  // T-52: a gif must never travel down the emoji path. insertEmoji routes to the emoji node,
  // which renders at 1.3em, is an atom, drops its blob in the markdown serializer and has no
  // html serializer case at all.
  it('routes a gif result to insertGif and never to insertEmoji', async () => {
    await openPicker()
    captured?.({ kind: 'gif', 'file-id': 'blob-1', width: 320, height: 240 })
    expect(handler.insertGif).toHaveBeenCalledTimes(1)
    expect(handler.insertEmoji).not.toHaveBeenCalled()
    expect(handler.focus).toHaveBeenCalled()
  })

  // T-53: the unaffected majority. Every existing emoji user hits this path.
  it('routes a unicode emoji result to insertEmoji unchanged', async () => {
    await openPicker()
    captured?.({ kind: 'emoji', text: '🎉', image: undefined })
    expect(handler.insertEmoji).toHaveBeenCalledWith('🎉', undefined)
    expect(handler.insertGif).not.toHaveBeenCalled()
    expect(handler.focus).toHaveBeenCalled()
  })

  // T-54: the image argument is what makes a CUSTOM emoji render as an image instead of
  // literal :shortcode: text. The guards can be perfect and this can still be dropped at the
  // call site, so it is asserted on the call, not on the guard.
  it('forwards the image argument for a custom emoji', async () => {
    await openPicker()
    captured?.({ kind: 'emoji', text: ':party:', image: 'blob-9' })
    expect(handler.insertEmoji).toHaveBeenCalledWith(':party:', 'blob-9')
  })

  // T-55: the popup framework calls back with undefined on dismiss. Losing this guard means
  // an insert on every Escape and every click-outside.
  it('inserts nothing when the picker is dismissed', async () => {
    for (const dismissal of [undefined, null]) {
      await openPicker()
      captured?.(dismissal)
      expect(handler.insertEmoji).not.toHaveBeenCalled()
      expect(handler.insertGif).not.toHaveBeenCalled()
    }
  })
})
