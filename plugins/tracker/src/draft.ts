//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Draft items (GitHub Projects "draft issue"): a real project item that is not an issue yet. A draft is an issue document
// with `isDraft: true`, so that it takes part in every view, filter, field, board and roadmap of the project unchanged.
// It has no number in the project sequence (it would waste one for every idea that is never converted): its number is
// 0, which the sequence never hands out, and its identifier is a placeholder. Converting it gives it the next number of
// the project and clears the flag.

/** Longest title of an item, like GitHub (256 characters). @public */
export const MAX_ITEM_TITLE_LENGTH = 256

/** Number of a draft. The project sequence starts at 1, so no issue has it. @public */
export const DRAFT_NUMBER = 0

/**
 * Whether an issue is a draft item: a converted draft carries `false`, an issue that was never a draft has no value.
 * @public
 */
export function isIssueDraft (issue: { isDraft?: boolean | null }): boolean {
  return issue.isDraft === true
}

/**
 * The part of a `DocumentQuery` that selects drafts (`true`), or the items that are not drafts (`false`). The second
 * one also matches issues that never had the property.
 * @public
 */
export function draftQuery (draft: boolean): { isDraft: true } | { isDraft: { $ne: true } } {
  return draft ? { isDraft: true } : { isDraft: { $ne: true } }
}

/**
 * Identifier stored on a draft. It is only a placeholder (the views show "Draft"): it does not look like an issue id
 * (`PROJ-12`), so no link or search resolves it to an issue, and a draft is opened by its document id.
 * @public
 */
export function draftIdentifier (projectIdentifier: string): string {
  return `${projectIdentifier}-Draft`
}

const DRAFT_LINK_PREFIX = 'draft-'

/**
 * The part of a link that opens a draft. A draft has no issue id (`PROJ-12`), so it is addressed by its document id,
 * with a prefix that no issue id and no project id has.
 * @public
 */
export function draftLinkSegment (id: string): string {
  return `${DRAFT_LINK_PREFIX}${id}`
}

/**
 * The document id a link segment of a draft stands for, `undefined` when the segment is not a draft link.
 * @public
 */
export function parseDraftLinkSegment (segment: string | undefined): string | undefined {
  if (segment === undefined || !segment.startsWith(DRAFT_LINK_PREFIX) || segment.length === DRAFT_LINK_PREFIX.length) {
    return undefined
  }
  return segment.slice(DRAFT_LINK_PREFIX.length)
}

/**
 * The part of a link that opens an item: the identifier of an issue, the prefixed document id of a draft.
 * @public
 */
export function issueLinkSegment (issue: { _id: string, identifier: string, isDraft?: boolean | null }): string {
  return issue.isDraft === true ? draftLinkSegment(issue._id) : issue.identifier
}

/**
 * The update that turns a draft into an issue: the number taken from the project sequence, the identifier built from it
 * and the cleared flag. `false` (not removal), because an update cannot remove a property.
 * @public
 */
export function convertDraftUpdate (
  number: number,
  projectIdentifier: string
): { number: number, identifier: string, isDraft: false } {
  return { number, identifier: `${projectIdentifier}-${number}`, isDraft: false }
}

/**
 * What was typed into the "Add item" row.
 * - `empty`: nothing to add yet.
 * - `draft`: a title; Enter creates a draft item.
 * - `search`: text that starts with `#`; the rest searches existing issues.
 * - `too-long`: the title is longer than an item title can be.
 * @public
 */
export type AddItemInput =
  | { kind: 'empty' }
  | { kind: 'draft', title: string }
  | { kind: 'search', query: string }
  | { kind: 'too-long', length: number }

/**
 * Reads the text of the "Add item" row (GitHub: a title makes a draft, `#` searches issues).
 * @public
 */
export function parseAddItemInput (text: string): AddItemInput {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'empty' }
  if (trimmed.startsWith('#')) return { kind: 'search', query: trimmed.slice(1).trim() }
  if (trimmed.length > MAX_ITEM_TITLE_LENGTH) return { kind: 'too-long', length: trimmed.length }
  return { kind: 'draft', title: trimmed }
}
