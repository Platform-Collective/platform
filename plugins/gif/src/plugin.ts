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
import { type Asset, type IntlString, type Metadata, plugin, type Plugin } from '@hcengineering/platform'
import { type AnyComponent } from '@hcengineering/ui'
import type { Class, Doc, Ref } from '@hcengineering/core'
import type { WorkspaceGif } from './types'

/** @public */
export const gifId = 'gif' as Plugin

export const gifPlugin = plugin(gifId, {
  ids: {
    WorkspaceGif: '' as Ref<Doc>
  },
  class: {
    WorkspaceGif: '' as Ref<Class<WorkspaceGif>>
  },
  component: {
    GifPickerPopup: '' as AnyComponent,
    SettingsGifTable: '' as AnyComponent
  },
  string: {
    Emoji: '' as IntlString,
    Gifs: '' as IntlString,
    SearchGifs: '' as IntlString,
    Upload: '' as IntlString,
    UploadGif: '' as IntlString,
    NoGifsYet: '' as IntlString,
    NoGifsYetHint: '' as IntlString,
    NoResults: '' as IntlString,
    NoResultsHint: '' as IntlString,
    Loading: '' as IntlString,
    LoadMore: '' as IntlString,
    Remove: '' as IntlString,
    Title: '' as IntlString,
    Keywords: '' as IntlString,
    Width: '' as IntlString,
    Height: '' as IntlString,
    Size: '' as IntlString,
    Sha256: '' as IntlString,
    GifLibrary: '' as IntlString,
    RecentlyUsed: '' as IntlString,
    TooLarge: '' as IntlString,
    BadMime: '' as IntlString,
    BadDimensions: '' as IntlString,
    UploadFailed: '' as IntlString,
    AlreadyInLibrary: '' as IntlString,
    Unavailable: '' as IntlString,
    Giphy: '' as IntlString,
    SearchGiphy: '' as IntlString,
    PoweredByGiphy: '' as IntlString,
    GiphyRateLimited: '' as IntlString,
    GiphyRateLimitedHint: '' as IntlString,
    GiphyUnavailable: '' as IntlString,
    GiphyUnavailableHint: '' as IntlString
  },
  icon: {
    Gif: '' as Asset
  },
  metadata: {
    // Set from config.json GIPHY_API_KEY. Absent means the Giphy tab hides itself and the
    // picker falls back to the workspace library alone, which is why every read of this is
    // treated as optional rather than asserted.
    //
    // This key reaches the browser by design. GIPHY require it: "All requests to GIPHY should
    // be made directly from the client side" and "Do not proxy requests to GIPHY, either API
    // calls or media URL loads". A beta key is rate limited rather than billed, so exposure
    // costs throughput, not money.
    GiphyApiKey: '' as Metadata<string>
  }
})

export default gifPlugin
