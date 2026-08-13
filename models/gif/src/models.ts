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
import gifPlugin from './plugin'
import { ArrOf, Model, Prop, ReadOnly, TypeNumber, TypeRef, TypeString } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import type { Ref, Blob, Domain } from '@hcengineering/core'
import { type WorkspaceGif } from '@hcengineering/gif'

export const DOMAIN_GIF = 'gif' as Domain

@Model(gifPlugin.class.WorkspaceGif, core.class.Doc, DOMAIN_GIF)
export class TWorkspaceGif extends TDoc implements WorkspaceGif {
  @Prop(TypeString(), gifPlugin.string.Title)
    title!: string

  @Prop(ArrOf(TypeString()), gifPlugin.string.Keywords)
    keywords!: string[]

  @Prop(TypeRef(core.class.Blob), gifPlugin.string.GifLibrary)
  @ReadOnly()
    blob!: Ref<Blob>

  @Prop(TypeNumber(), gifPlugin.string.Width)
  @ReadOnly()
    width!: number

  @Prop(TypeNumber(), gifPlugin.string.Height)
  @ReadOnly()
    height!: number

  @Prop(TypeNumber(), gifPlugin.string.Size)
  @ReadOnly()
    size!: number

  // Dedup key: uploading the same bytes twice returns the existing row rather than adding a
  // second one and a second blob.
  @Prop(TypeString(), gifPlugin.string.Sha256)
  @ReadOnly()
    sha256!: string
}
