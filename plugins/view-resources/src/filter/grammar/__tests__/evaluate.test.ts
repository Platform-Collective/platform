//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { evaluate } from '../evaluate'
import { parseFilter } from '../parser'
import { ctx, DAY, ISSUES, NOW, schema } from './fixtures'

function titles (input: string): string[] {
  const res = parseFilter(input, schema)
  if (!res.ok) throw new Error(`${input}: ${res.error.message}`)
  return ISSUES.filter((d) => evaluate(res.value, d, ctx)).map((d) => d.title)
}

describe('evaluate: built-in fields', () => {
  it('matches everything for an empty filter', () => {
    expect(titles('')).toHaveLength(ISSUES.length)
  })

  it('matches free text in the title, case-insensitively', () => {
    expect(titles('LOGIN')).toEqual(['Fix login bug'])
    expect(titles('"login bug"')).toEqual(['Fix login bug'])
    expect(titles('fix bug')).toEqual(['Fix login bug'])
    expect(titles('title:"dark theme"')).toEqual(['Add dark theme'])
    expect(titles('title:*coverage')).toEqual(['Refactor API 100% coverage'])
  })

  it('matches status by label with OR and wildcards', () => {
    expect(titles('status:Done')).toEqual(['Release notes'])
    expect(titles('status:todo,done')).toEqual(['Add dark theme', 'Release notes'])
    expect(titles('status:"In Progress"')).toEqual(['Fix login bug', 'Plain issue'])
    expect(titles('status:in*')).toEqual(['Fix login bug', 'Plain issue'])
    expect(titles('status:nothing')).toEqual([])
  })

  it('negates a field', () => {
    expect(titles('-status:Done,Canceled,Todo')).toEqual(['Fix login bug', 'Plain issue'])
  })

  it('matches priority, assignee and @me', () => {
    expect(titles('priority:Urgent')).toEqual(['Fix login bug'])
    expect(titles('priority:urgent,high')).toEqual(['Fix login bug', 'Refactor API 100% coverage'])
    expect(titles('assignee:@me')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('assignee:alice')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('assignee:"bob smith"')).toEqual(['Add dark theme', 'Plain issue'])
    expect(titles('-assignee:@me')).toEqual(['Add dark theme', 'Refactor API 100% coverage', 'Plain issue'])
  })

  it('matches @me to nothing without a current user', () => {
    const res = parseFilter('assignee:@me', schema)
    if (!res.ok) throw new Error()
    expect(ISSUES.some((d) => evaluate(res.value, d, { ...ctx, me: undefined }))).toBe(false)
  })

  it('matches labels with any-of and repeated fields as AND', () => {
    expect(titles('label:bug')).toEqual(['Fix login bug', 'Refactor API 100% coverage'])
    expect(titles('label:bug,ui')).toEqual(['Fix login bug', 'Add dark theme', 'Refactor API 100% coverage'])
    expect(titles('label:bug label:ui')).toEqual(['Refactor API 100% coverage'])
    expect(titles('label:"good first issue"')).toEqual(['Add dark theme'])
    expect(titles('-label:bug')).toEqual(['Add dark theme', 'Release notes', 'Plain issue'])
  })

  it('matches milestone', () => {
    expect(titles('milestone:v1')).toEqual(['Fix login bug'])
    expect(titles('no:milestone')).toEqual(['Release notes', 'Refactor API 100% coverage', 'Plain issue'])
  })

  it('supports has: and no:', () => {
    expect(titles('has:assignee')).toEqual(['Fix login bug', 'Add dark theme', 'Release notes', 'Plain issue'])
    expect(titles('no:assignee')).toEqual(['Refactor API 100% coverage'])
    expect(titles('no:label')).toEqual(['Release notes', 'Plain issue'])
    expect(titles('has:label')).toHaveLength(3)
    expect(titles('has:parent-issue')).toEqual(['Refactor API 100% coverage'])
    expect(titles('no:parent-issue')).toHaveLength(4)
    expect(titles('no:assignee,due')).toEqual(['Refactor API 100% coverage', 'Plain issue'])
  })

  it('supports is:open and is:closed', () => {
    expect(titles('is:open')).toEqual(['Fix login bug', 'Add dark theme', 'Plain issue'])
    expect(titles('is:closed')).toEqual(['Release notes', 'Refactor API 100% coverage'])
    expect(titles('is:issue')).toHaveLength(5)
    expect(titles('is:sub-issue')).toEqual(['Refactor API 100% coverage'])
    expect(titles('-is:closed')).toHaveLength(3)
  })
})

describe('evaluate: numbers', () => {
  it('compares with exact, strict and inclusive operators', () => {
    expect(titles('estimate:5')).toEqual(['Fix login bug'])
    expect(titles('estimate:>5')).toEqual(['Add dark theme', 'Refactor API 100% coverage'])
    expect(titles('estimate:>=5')).toHaveLength(3)
    expect(titles('estimate:<5')).toEqual(['Release notes', 'Plain issue'])
    expect(titles('estimate:<=5')).toHaveLength(3)
  })

  it('supports inclusive ranges and wildcards', () => {
    expect(titles('estimate:1..5')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('estimate:8..*')).toEqual(['Add dark theme', 'Refactor API 100% coverage'])
    expect(titles('estimate:*..1')).toEqual(['Release notes', 'Plain issue'])
  })

  it('does not match a missing value', () => {
    expect(titles('story-points:<100')).toEqual(['Fix login bug', 'Add dark theme', 'Release notes', 'Refactor API 100% coverage'])
  })
})

describe('evaluate: dates', () => {
  it('matches a whole day for equality', () => {
    expect(titles('due:@today')).toEqual(['Fix login bug'])
    expect(titles(`due:${new Date(NOW + 20 * DAY).getFullYear()}-${String(new Date(NOW + 20 * DAY).getMonth() + 1).padStart(2, '0')}-${String(new Date(NOW + 20 * DAY).getDate()).padStart(2, '0')}`)).toEqual(['Release notes'])
  })

  it('treats comparisons on whole days (Phase 1 semantics)', () => {
    expect(titles('due:<@today')).toEqual(['Add dark theme'])
    expect(titles('due:<=@today')).toEqual(['Fix login bug', 'Add dark theme'])
    expect(titles('due:>@today')).toEqual(['Release notes'])
    expect(titles('due:>=@today')).toEqual(['Fix login bug', 'Release notes'])
  })

  it('supports relative offsets', () => {
    expect(titles('due:>@today-7d')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('due:>@today-14d due:<@today+1d')).toEqual(['Fix login bug', 'Add dark theme'])
  })

  it('includes both end days of a range', () => {
    expect(titles('due:@today-10d..@today')).toEqual(['Fix login bug', 'Add dark theme'])
    expect(titles('due:@today..*')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('due:*..@today-10d')).toEqual(['Add dark theme'])
  })

  it('applies to custom date fields', () => {
    expect(titles('target:>@today')).toEqual(['Fix login bug'])
    expect(titles('no:target')).toHaveLength(4)
  })
})

describe('evaluate: custom fields', () => {
  it('matches numbers', () => {
    expect(titles('story-points:>=8')).toEqual(['Add dark theme', 'Refactor API 100% coverage'])
    expect(titles('story-points:1..3')).toEqual(['Fix login bug', 'Release notes'])
  })

  it('matches text by substring', () => {
    expect(titles('notes:qa')).toEqual(['Fix login bug'])
    expect(titles('has:notes')).toEqual(['Fix login bug'])
  })

  it('matches single select by label', () => {
    expect(titles('size:M')).toEqual(['Fix login bug'])
    expect(titles('size:s,l')).toEqual(['Add dark theme', 'Release notes'])
    expect(titles('-size:M')).toHaveLength(4)
    expect(titles('no:size')).toEqual(['Refactor API 100% coverage', 'Plain issue'])
  })

  it('matches multi select any-of and treats an empty list as empty', () => {
    expect(titles('area:frontend')).toEqual(['Fix login bug', 'Add dark theme'])
    expect(titles('area:backend,frontend')).toEqual(['Fix login bug', 'Add dark theme'])
    expect(titles('no:area')).toEqual(['Release notes', 'Refactor API 100% coverage', 'Plain issue'])
  })

  it('matches iterations by keyword, arithmetic and title', () => {
    expect(titles('iteration:@current')).toEqual(['Fix login bug'])
    expect(titles('iteration:@next')).toEqual(['Add dark theme'])
    expect(titles('iteration:@previous')).toEqual(['Release notes'])
    expect(titles('iteration:@current+1')).toEqual(['Add dark theme'])
    expect(titles('iteration:@previous,@next')).toEqual(['Add dark theme', 'Release notes'])
    expect(titles('iteration:"Sprint 3"')).toEqual(['Add dark theme'])
    expect(titles('iteration:@current..@next')).toEqual(['Fix login bug', 'Add dark theme'])
    expect(titles('iteration:>@current')).toEqual(['Add dark theme'])
    expect(titles('iteration:<=@current')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('iteration:@current+5')).toEqual([])
  })
})

describe('evaluate: boolean structure', () => {
  it('supports OR across different fields', () => {
    expect(titles('priority:urgent OR status:done')).toEqual(['Fix login bug', 'Release notes'])
  })

  it('supports parentheses and implicit AND', () => {
    expect(titles('(priority:urgent OR status:done) assignee:@me')).toEqual(['Fix login bug', 'Release notes'])
    expect(titles('(priority:urgent OR status:done) label:bug')).toEqual(['Fix login bug'])
  })

  it('supports negated groups', () => {
    expect(titles('-(status:done OR status:canceled)')).toEqual(['Fix login bug', 'Add dark theme', 'Plain issue'])
  })

  it('combines free text with fields', () => {
    expect(titles('bug status:"in progress"')).toEqual(['Fix login bug'])
  })
})
