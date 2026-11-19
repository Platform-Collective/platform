// SPDX-License-Identifier: EPL-2.0
import type { Client } from '@hcengineering/core'
import { escapeMarkdownLinkText, escapeMarkdownLinkUrl } from '@hcengineering/converter-resources'
import task from '@hcengineering/task'
import tracker, { type Issue, type Milestone } from '@hcengineering/tracker'

export type ReleaseIssue = Pick<Issue, '_id' | 'identifier' | 'number' | 'kind' | 'title'>

/** Read the complete milestone, independently of the current view's filters and limit. */
export async function loadMilestoneIssues (
  client: Client,
  milestone: Pick<Milestone, '_id' | 'space'>
): Promise<Issue[]> {
  const statuses = await client.findAll(tracker.class.IssueStatus, { category: task.statusCategory.Won })
  if (statuses.length === 0) return []
  return await client.findAll(tracker.class.Issue, {
    space: milestone.space,
    milestone: milestone._id,
    status: { $in: statuses.map((status) => status._id) }
  })
}

function plain (value: string): string {
  return escapeMarkdownLinkText(value.replace(/\r\n?|\n/g, ' '))
    .replace(/[*_`#~]/g, '\\$&')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function compare (a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Stable numeric order, including a tie-breaker for legacy identifiers. */
export function formatReleaseList (
  label: string,
  issues: ReleaseIssue[],
  link: (identifier: string) => string,
  headers: [string, string] = ['ID', 'Title']
): string {
  const rows = [...issues].sort(
    (a, b) => a.number - b.number || compare(a.identifier, b.identifier) || compare(a._id, b._id)
  )
  let text = `## ${plain(label)}\n\n| ${headers.map(plain).join(' | ')} |\n| --- | --- |\n`
  for (const issue of rows) {
    text += `| [${plain(issue.identifier)}](${escapeMarkdownLinkUrl(
      link(issue.identifier)
    )}) | ${plain(issue.title)} |\n`
  }
  return text
}
