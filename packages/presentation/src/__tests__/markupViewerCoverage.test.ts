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

// Structural, because no component-mounting harness exists in this repo. That gap is exactly how
// the defect this file guards against reached review: a gif node serialized correctly, round
// tripped correctly, passed 257 tests, and then rendered in chat as the literal text
// unknown node: "gif" - because NodeContent.svelte had a branch for image and none for gif, and no
// test reads that file. Serialization coverage says nothing about the read path.

const COMPONENTS = join(__dirname, '..', 'components', 'markup')

function source (relative: string): string {
  return readFileSync(join(COMPONENTS, relative), 'utf8')
}

// Every node type a message composer can put into stored markup. A viewer that lacks a branch for
// one of these does not fail: it prints the type name as text (NodeContent) or renders nothing at
// all (LiteNodeContent), so the message looks broken or empty to the reader while the content is
// perfectly intact in the database.
const COMPOSABLE_NODES = ['emoji', 'gif']

describe('markup viewers cover every composable node type', () => {
  it.each(COMPOSABLE_NODES)('NodeContent.svelte handles %s', (nodeType) => {
    expect(source('NodeContent.svelte')).toContain(`node.type === MarkupNodeType.${nodeType}`)
  })

  it.each(COMPOSABLE_NODES)('LiteNodeContent.svelte handles %s', (nodeType) => {
    expect(source('lite/LiteNodeContent.svelte')).toContain(`node.type === MarkupNodeType.${nodeType}`)
  })

  // The fallback is what makes a missing branch silent rather than loud, so pin both halves: the
  // fallback still exists (this test is not passing because someone deleted it) and it is the LAST
  // branch (a node type added after it would be unreachable).
  it('NodeContent.svelte still ends in the unknown-node fallback', () => {
    const text = source('NodeContent.svelte')
    expect(text).toContain('unknown node:')
    const lastBranch = text.lastIndexOf('node.type === MarkupNodeType.')
    expect(text.indexOf('unknown node:')).toBeGreaterThan(lastBranch)
  })

  // A gif carries the blob in 'file-id' and an external URL in 'src', independently, and 'file-id'
  // wins. The editor node view establishes that precedence; a viewer that reads 'src' alone shows
  // nothing for every library gif, which is the common case.
  it.each([['NodeContent.svelte'], ['lite/LiteNodeContent.svelte']])(
    '%s prefers file-id over src for a gif',
    (file) => {
      const text = source(file)
      const gifBranch = text.indexOf('node.type === MarkupNodeType.gif')
      expect(gifBranch).toBeGreaterThan(-1)
      const branch = text.slice(gifBranch, gifBranch + 900)
      expect(branch).toContain("attrs['file-id']")
      expect(branch.indexOf("attrs['file-id']")).toBeLessThan(branch.indexOf('attrs.src'))
    }
  )
})
