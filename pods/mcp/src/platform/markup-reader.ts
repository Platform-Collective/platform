/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

/**
 * Resolves a markup blob reference to its text content.
 *
 * An interface rather than a concrete class so tool handlers depend on the
 * capability, not on HTTP.
 */
export interface MarkupReader {
  read: (ref: string) => Promise<string>
}

/**
 * Stores rich text in the workspace and returns the blob reference to keep on
 * the owning document. Writing goes through the collaborator service, which is
 * optional infrastructure, so a session may have no writer at all.
 */
export interface MarkupWriter {
  write: (objectClass: string, objectId: string, attribute: string, markdown: string) => Promise<string>
  /** Replaces the text behind an existing blob reference; the reference itself does not change. */
  update: (objectClass: string, objectId: string, attribute: string, markdown: string) => Promise<void>
}

/** Reads a bounded number of characters, appending a marker when it truncates. */
export function truncate (value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n… [truncated, ${value.length} characters total]`
}
