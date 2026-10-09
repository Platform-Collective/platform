// SPDX-License-Identifier: EPL-2.0
import { toggleViewed } from '../viewed-files'

describe('toggleViewed', () => {
  it('ticks a file version once, and unticks only that version', () => {
    const ticked = toggleViewed(toggleViewed([], 'a.ts', 's1', true), 'a.ts', 's1', true)
    expect(ticked).toEqual([{ fileName: 'a.ts', sha: 's1' }])
    const both = toggleViewed(ticked, 'a.ts', 's2', true)
    expect(toggleViewed(both, 'a.ts', 's1', false)).toEqual([{ fileName: 'a.ts', sha: 's2' }])
  })
})
