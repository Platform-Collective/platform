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

import { ToolRegistry } from '../mcp/tool'
import { documentTools } from './document-tools'
import { issueTools } from './issue-tools'
import { personTools } from './people-tools'
import { projectTools } from './project-tools'
import { searchTools } from './search-tool'

/**
 * The complete tool surface of the server.
 *
 * Adding a capability means adding a file and appending it here; nothing else in
 * the pod needs to change. Read tools come first so `tools/list` reads as a
 * progression from "look" to "change" — the order is what a model sees.
 */
export function buildRegistry (): ToolRegistry {
  return new ToolRegistry().registerAll([
    ...searchTools,
    ...projectTools,
    ...issueTools,
    ...personTools,
    ...documentTools
  ])
}

/** Shown to the model after `initialize`; steers it to the right tool first. */
export const MCP_INSTRUCTIONS = [
  'This server exposes the Huly workspace of the authenticated user.',
  '',
  'Getting started:',
  '1. huly_search when you only know a topic; it returns ids for everything below.',
  '2. huly_list_projects to see the projects the user belongs to.',
  '3. huly_list_issues / huly_list_documents to read within a project or space.',
  '',
  'Writing:',
  '- Issue statuses are documents, not strings. Call huly_list_issue_statuses to get valid ids',
  '  before huly_update_issue.',
  '- People are referenced by id. Call huly_find_people to resolve a name to an id.',
  '- Tools that modify data are refused when the server runs in read-only mode.',
  '',
  'Ids are opaque strings. Always pass an id obtained from a list or search tool rather than',
  'guessing one, and read a project before creating issues in it.'
].join('\n')
