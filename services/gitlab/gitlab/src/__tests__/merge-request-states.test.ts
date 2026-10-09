// SPDX-License-Identifier: EPL-2.0
import task from '@hcengineering/task'
import { gitlabMergeRequestStates } from '..'

describe('gitlabMergeRequestStates', () => {
  it('has Open (Active), Merged (Won) and Closed (Lost), one status each', () => {
    const names = gitlabMergeRequestStates.map((it) => [
      it.category,
      it.statuses.map((s) => (Array.isArray(s) ? s[0] : s))
    ])
    expect(names).toEqual([
      [task.statusCategory.Active, ['Open']],
      [task.statusCategory.Won, ['Merged']],
      [task.statusCategory.Lost, ['Closed']]
    ])
  })
})
