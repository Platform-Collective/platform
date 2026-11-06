// SPDX-License-Identifier: EPL-2.0
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

export interface ChatMessageInputData {
  message: string
  attachments: number
}

export interface ChatMessageEditData {
  message: string
  editedOn: number
}

/**
 * Build the update for an existing message.
 *
 * Attachment collection transactions maintain their parent counter, so the
 * editor's attachment snapshot must not overwrite it.
 */
export function getChatMessageEditData ({ message }: ChatMessageInputData, editedOn: number): ChatMessageEditData {
  return { message, editedOn }
}
