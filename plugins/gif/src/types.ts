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

import type { Blob, Doc, Ref } from '@hcengineering/core'

/**
 * A GIF uploaded into the workspace's shared library.
 *
 * width and height are stored so the grid can reserve the right box before the image loads,
 * which is what stops the grid reflowing as GIFs arrive. sha256 is the dedup key: uploading
 * the same GIF twice should return the existing row rather than adding a second one.
 *
 * @public
 */
export interface WorkspaceGif extends Doc {
  title: string
  keywords: string[]
  blob: Ref<Blob>
  width: number
  height: number
  size: number
  sha256: string
}

/**
 * What the picker hands back. A discriminated union because nothing type-checks it at the
 * call site: showPopup's callback is (result: any) => void and RefInputAction returns void,
 * so a mis-shaped result fails silently at runtime rather than at compile time.
 *
 * @public
 */
export type GifPickerResult =
  | { kind: 'emoji', text: string, codes?: unknown, image?: Ref<Blob> }
  | { kind: 'gif', 'file-id'?: Ref<Blob>, src?: string, width?: number, height?: number, alt?: string }

/** @public */
export type UploadRejection = 'too-large' | 'bad-mime' | 'bad-dimensions'

/**
 * A reason, never a message. Tests bind to the reason so a copy edit cannot turn them red,
 * and the reason maps to an IntlString so a new rejection cannot ship without a message.
 *
 * @public
 */
export type UploadValidation = { ok: true } | { ok: false, reason: UploadRejection }

/** @public */
export interface GifGridPage {
  items: WorkspaceGif[]
  hasMore: boolean
}
