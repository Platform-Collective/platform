// SPDX-License-Identifier: EPL-2.0

import { ToolRegistry } from '../mcp/tool'
import { accountTools } from './account-tools'
import { componentTools } from './component-tools'
import { documentTools } from './document-tools'
import { documentWriteTools } from './document-write-tools'
import { genericWriteTools } from './generic-write-tools'
import { issueTools } from './issue-tools'
import { modelTools } from './model-tools'
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
    ...accountTools,
    ...projectTools,
    ...issueTools,
    ...componentTools,
    ...personTools,
    ...documentTools,
    ...documentWriteTools,
    ...modelTools,
    ...genericWriteTools
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
  '- Sub-issues are created with huly_create_issue and parentIssueId; components come from huly_list_components.',
  '- People are referenced by id. Call huly_find_people to resolve a name to an id.',
  '- For anything the named tools do not cover, discover it: huly_list_classes -> huly_describe_class ->',
  '  huly_find / huly_get_doc. These can read any class the caller is allowed to see.',
  '- Creating and editing pages: huly_create_document / huly_update_document. Other creates, updates and deletes:',
  '  huly_create_doc / huly_update_doc / huly_delete_doc, which list the classes they support in their errors.',
  '  Deletes are permanent; only a workspace owner or the creator of a document may delete it.',
  '- Tools that modify data are refused when the server runs in read-only mode.',
  '',
  'Ids are opaque strings. Always pass an id obtained from a list or search tool rather than',
  'guessing one, and read a project before creating issues in it.'
].join('\n')
