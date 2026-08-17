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

import { readFileSync } from 'fs'
import { join } from 'path'
// GifNode, not GifExtension: the extension imports @hcengineering/presentation, which pulls
// Svelte into jest. The node carries the semantics; the extension only adds a node view.
import { GifNode } from '@hcengineering/text'

// Structural assertions, because the failure being guarded is a registration that produces no
// error. The editor kit and the composers' kitOptions are plain source; a schema built here
// from GifNode would prove only that GifNode works, which is not the risk. Resolve from
// __dirname so the test cannot pass vacuously against an empty read under a different cwd.
const repoRoot = join(__dirname, '../../../../..')
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8')

const EDITOR_KIT = 'plugins/text-editor-resources/src/kits/editor-kit.ts'
const COMPOSERS = [
  'plugins/attachment-resources/src/components/AttachmentRefInput.svelte',
  'plugins/communication-resources/src/components/TextInput.svelte'
]

describe('gif registration in the editor kit', () => {
  it('reads real files, not an empty string', () => {
    expect(read(EDITOR_KIT).length).toBeGreaterThan(1000)
    for (const c of COMPOSERS) expect(read(c).length).toBeGreaterThan(1000)
  })

  // BRD 1.5. Without the kit entry the gif node does not exist in any editor schema and
  // an inserted gif is dropped by ProseMirror with no error.
  it('registers the gif extension in the editor kit', () => {
    expect(read(EDITOR_KIT)).toMatch(/gif:\s*e\(GifExtension\)/)
  })

  // the tab is useless on a surface whose schema lacks the node. Both composers must
  // enable it explicitly, the same way emoji is enabled explicitly in the communication one.
  it.each(COMPOSERS)('enables gif in the kitOptions of %s', (composer) => {
    expect(read(composer)).toMatch(/gif:\s*true/)
  })

  // image stays off. Flipping it would switch on inline image paste in chat, colliding
  // with the attachment flow, and is the tempting shortcut this whole node exists to avoid.
  it.each(COMPOSERS)('leaves the image node disabled in %s', (composer) => {
    expect(read(composer)).toMatch(/image:\s*false/)
  })
})

describe('gif node semantics', () => {
  // inline and selectable, so it sits in a line of text and can be selected or deleted
  // like any other content. Schema construction itself is covered by the server-kit registration test
  // kit; asserting it again here would only re-test tiptap.
  it('is an inline, selectable, non-atom node', () => {
    expect(GifNode.name).toBe('gif')
    expect(GifNode.config.inline).toBe(true)
    expect(GifNode.config.group).toBe('inline')
    expect(GifNode.config.selectable).toBe(true)
    expect(GifNode.config.atom).not.toBe(true)
  })

  it('declares file-id and src as independent attributes', () => {
    const attrs = (GifNode.config.addAttributes as () => Record<string, unknown>).call(GifNode)
    expect(Object.keys(attrs)).toEqual(expect.arrayContaining(['file-id', 'src', 'width', 'height', 'alt']))
  })
})

// BRD section 2 - implemented in every handler or it is a silent no-op in that surface.
// Five files, not four: TextEditor.svelte holds the low-level export that ReferenceInput,
// StyledTextEditor and the communication TextInput all delegate to.
const HANDLERS = [
  'plugins/text-editor/src/types.ts',
  'plugins/text-editor-resources/src/components/TextEditor.svelte',
  'plugins/text-editor-resources/src/components/CollaborativeTextEditor.svelte',
  'plugins/text-editor-resources/src/components/ReferenceInput.svelte',
  'plugins/text-editor-resources/src/components/StyledTextEditor.svelte',
  'plugins/communication-resources/src/components/TextInput.svelte'
]

describe('insertGif across every editor handler', () => {
  it.each(HANDLERS)('is declared or implemented in %s', (file) => {
    const src = read(file)
    expect(src.length).toBeGreaterThan(500)
    expect(src).toContain('insertGif')
  })

  // Every file that implements insertEmoji must also implement insertGif. Pins the pairing so a
  // sixth surface added later cannot quietly ship with only half the handler.
  it('is implemented everywhere insertEmoji is', () => {
    const missing = HANDLERS.filter((f) => read(f).includes('insertEmoji') && !read(f).includes('insertGif'))
    expect(missing).toEqual([])
  })
})
