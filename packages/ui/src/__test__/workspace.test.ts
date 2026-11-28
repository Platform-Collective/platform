//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { matchWorkspaceSearch } from '../workspace'

describe('matchWorkspaceSearch', () => {
  const ws = { name: 'Acme Platform', url: 'acme-prod' }

  it('matches everything for an empty or whitespace-only search', () => {
    expect(matchWorkspaceSearch(ws, '')).toBe(true)
    expect(matchWorkspaceSearch(ws, '   ')).toBe(true)
  })

  it('matches the title case-insensitively', () => {
    expect(matchWorkspaceSearch(ws, 'platform')).toBe(true)
    expect(matchWorkspaceSearch(ws, 'ACME')).toBe(true)
  })

  it('matches the URL and ignores surrounding whitespace', () => {
    expect(matchWorkspaceSearch(ws, ' PROD ')).toBe(true)
  })

  it('matches by URL when the workspace has no title', () => {
    expect(matchWorkspaceSearch({ url: 'acme-prod' }, 'acme')).toBe(true)
    expect(matchWorkspaceSearch({ url: 'acme-prod' }, 'other')).toBe(false)
  })
})
