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
import { type Asset, type IntlString, plugin, type Plugin } from '@hcengineering/platform'
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
    Unavailable: '' as IntlString
  },
  icon: {
    Gif: '' as Asset
  }
})

export default gifPlugin
