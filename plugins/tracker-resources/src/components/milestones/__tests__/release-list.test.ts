// SPDX-License-Identifier: EPL-2.0
import type { Client } from '@hcengineering/core'
import task from '@hcengineering/task'
import tracker, { type Issue, type Milestone } from '@hcengineering/tracker'
import { formatReleaseList, loadMilestoneIssues, type ReleaseIssue } from '../release-list'

const milestone: Pick<Milestone, '_id' | 'space' | 'label'> = {
  _id: 'release' as Milestone['_id'],
  space: 'project' as Milestone['space'],
  label: 'Version [1] | 日本語'
}
const issue = (id: string, number: number, kind = 'bug', title = 'Same title'): ReleaseIssue => ({
  _id: id as Issue['_id'],
  identifier: `TEST-${number}`,
  number,
  kind: kind as Issue['kind'],
  title
})

describe('milestone release list', () => {
  it('queries all completed statuses and issues in this project and milestone, without a view limit', async () => {
    const rows = Array.from({ length: 125 }, (_, i) => issue(`id-${i}`, i + 1))
    const findAll = jest
      .fn()
      .mockResolvedValueOnce([{ _id: 'won-a' }, { _id: 'won-b' }])
      .mockResolvedValueOnce(rows)
    expect(await loadMilestoneIssues({ findAll } as unknown as Client, milestone)).toEqual(rows)
    expect(findAll.mock.calls).toEqual([
      [tracker.class.IssueStatus, { category: task.statusCategory.Won }],
      [tracker.class.Issue, { space: 'project', milestone: 'release', status: { $in: ['won-a', 'won-b'] } }]
    ])
  })

  it('returns no issues when there are no successful statuses', async () => {
    const findAll = jest.fn().mockResolvedValue([])
    expect(await loadMilestoneIssues({ findAll } as unknown as Client, milestone)).toEqual([])
    expect(findAll).toHaveBeenCalledTimes(1)
  })

  it('propagates query failures instead of showing a partial release', async () => {
    const findAll = jest
      .fn()
      .mockResolvedValueOnce([{ _id: 'won' }])
      .mockRejectedValueOnce(new Error('offline'))
    await expect(loadMilestoneIssues({ findAll } as unknown as Client, milestone)).rejects.toThrow('offline')
  })

  it('orders by numeric ID, retains identical titles, and does not mutate the input', () => {
    const rows = [issue('ten', 10), issue('feature', 1, 'feature'), issue('two', 2)]
    const text = formatReleaseList(milestone.label, rows, (id) => `https://example.test/tracker/${id}`)
    expect(text.indexOf('TEST-1]')).toBeLessThan(text.indexOf('TEST-2]'))
    expect(text.indexOf('TEST-2]')).toBeLessThan(text.indexOf('TEST-10]'))
    expect(text.match(/Same title/g)).toHaveLength(3)
    expect(rows.map((r) => r._id)).toEqual(['ten', 'feature', 'two'])
  })

  it('escapes markdown, newlines and HTML and emits internal links as plain-text markdown', () => {
    const text = formatReleaseList(
      'Release **one**\n<script>',
      [issue('id', 3, 'bug', '[fix] | **bold** `_x_`\n<script> 日本語')],
      () => 'https://example.test/a)b'
    )
    expect(text).toContain('## Release \\*\\*one\\*\\* &lt;script&gt;')
    expect(text).toContain('\\[fix\\] \\| \\*\\*bold\\*\\* \\`\\_x\\_\\` &lt;script&gt; 日本語')
    expect(text).toContain('[TEST-3](https://example.test/a\\)b)')
    expect(text.split('\n')).toHaveLength(6)
    expect(formatReleaseList('Release "one"\'', [], (id) => id)).toContain('## Release &quot;one&quot;&#39;')
  })

  it('keeps all 125 rows and produces a heading and fixed columns for an empty milestone', () => {
    const text = formatReleaseList(
      'Release',
      Array.from({ length: 125 }, (_, i) => issue(`id-${i}`, i + 1)),
      (id) => `/tracker/${id}`
    )
    expect(text.match(/\[TEST-\d+\]/g)).toHaveLength(125)
    expect(formatReleaseList('Empty', [], (id) => id)).toBe('## Empty\n\n| ID | Title |\n| --- | --- |\n')
  })
})
