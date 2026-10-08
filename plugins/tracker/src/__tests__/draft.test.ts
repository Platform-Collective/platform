//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  convertDraftUpdate,
  draftIdentifier,
  draftLinkSegment,
  draftQuery,
  DRAFT_NUMBER,
  isIssueDraft,
  issueLinkSegment,
  MAX_ITEM_TITLE_LENGTH,
  parseAddItemInput,
  parseDraftLinkSegment
} from '../draft'

describe('draft items', () => {
  it('treats only true as a draft', () => {
    expect(isIssueDraft({})).toBe(false)
    expect(isIssueDraft({ isDraft: false })).toBe(false)
    expect(isIssueDraft({ isDraft: null })).toBe(false)
    expect(isIssueDraft({ isDraft: true })).toBe(true)
  })

  it('builds the queries for drafts and for items that are not drafts', () => {
    expect(draftQuery(true)).toEqual({ isDraft: true })
    expect(draftQuery(false)).toEqual({ isDraft: { $ne: true } })
  })

  it('gives a draft a number the sequence never hands out and an identifier that is no issue id', () => {
    expect(DRAFT_NUMBER).toBe(0)
    const identifier = draftIdentifier('PROJ')
    expect(identifier).toBe('PROJ-Draft')
    expect(/^\S+-\d+$/.test(identifier)).toBe(false)
  })

  it('converts with the next number of the project and clears the flag', () => {
    expect(convertDraftUpdate(7, 'PROJ')).toEqual({ number: 7, identifier: 'PROJ-7', isDraft: false })
    expect(isIssueDraft(convertDraftUpdate(7, 'PROJ'))).toBe(false)
  })
})

describe('draft links', () => {
  it('addresses a draft by its document id and an issue by its identifier', () => {
    expect(draftLinkSegment('abc123')).toBe('draft-abc123')
    expect(parseDraftLinkSegment('draft-abc123')).toBe('abc123')
    expect(issueLinkSegment({ _id: 'abc123', identifier: 'PROJ-Draft', isDraft: true })).toBe('draft-abc123')
    expect(issueLinkSegment({ _id: 'abc123', identifier: 'PROJ-7' })).toBe('PROJ-7')
    expect(issueLinkSegment({ _id: 'abc123', identifier: 'PROJ-7', isDraft: false })).toBe('PROJ-7')
  })

  it('does not take other segments for a draft link', () => {
    expect(parseDraftLinkSegment(undefined)).toBeUndefined()
    expect(parseDraftLinkSegment('')).toBeUndefined()
    expect(parseDraftLinkSegment('draft-')).toBeUndefined()
    expect(parseDraftLinkSegment('PROJ-12')).toBeUndefined()
    expect(parseDraftLinkSegment('issues')).toBeUndefined()
  })
})

describe('parseAddItemInput', () => {
  it('has nothing to add for blank text', () => {
    expect(parseAddItemInput('')).toEqual({ kind: 'empty' })
    expect(parseAddItemInput('   \t ')).toEqual({ kind: 'empty' })
  })

  it('makes a draft of a trimmed title', () => {
    expect(parseAddItemInput('  Write the docs ')).toEqual({ kind: 'draft', title: 'Write the docs' })
    expect(parseAddItemInput('Fix #12 later')).toEqual({ kind: 'draft', title: 'Fix #12 later' })
  })

  it('searches issues when the text starts with #', () => {
    expect(parseAddItemInput('#')).toEqual({ kind: 'search', query: '' })
    expect(parseAddItemInput(' # login bug ')).toEqual({ kind: 'search', query: 'login bug' })
    expect(parseAddItemInput('#PROJ-12')).toEqual({ kind: 'search', query: 'PROJ-12' })
  })

  it('refuses a title that is too long', () => {
    expect(parseAddItemInput('a'.repeat(MAX_ITEM_TITLE_LENGTH)).kind).toBe('draft')
    expect(parseAddItemInput('a'.repeat(MAX_ITEM_TITLE_LENGTH + 1))).toEqual({
      kind: 'too-long',
      length: MAX_ITEM_TITLE_LENGTH + 1
    })
  })
})
