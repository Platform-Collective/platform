//
// Copyright © 2026 Hardcore Engineering Inc.
// Copyright © 2026 Exaviz.
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

/**
 * A URL that can be embedded in an iframe. When `owned` is true the URL is a
 * blob: URL created for the embed, and the embedding component revokes it.
 */
export interface EmbeddableUrl {
  url: string
  owned: boolean
}

/**
 * Turns a file source into an embeddable URL. The caller (presentation layer)
 * supplies it, so the UI components never handle authentication.
 */
export type EmbeddableUrlResolver = (src: string, signal?: AbortSignal) => Promise<EmbeddableUrl>
