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

import { loadConfig } from '../config'
import { fakeEnv } from './test-doubles'

describe('loadConfig secret handling', () => {
  it('refuses to start without a secret', () => {
    expect(() => loadConfig(fakeEnv())).toThrow(/SECRET must be set/)
  })

  it('refuses the well-known default secret', () => {
    expect(() => loadConfig(fakeEnv({ SECRET: 'secret' }))).toThrow(/well-known default/)
  })

  it('accepts the default secret only when a dev stack opts in explicitly', () => {
    const config = loadConfig(fakeEnv({ SECRET: 'secret', MCP_ALLOW_DEFAULT_SECRET: 'true' }))
    expect(config.Secret).toBe('secret')
  })

  it('accepts a real secret and reads the collaborator url', () => {
    const config = loadConfig(fakeEnv({ SECRET: 'a-real-one', COLLABORATOR_URL: 'http://collab:3078' }))
    expect(config.CollaboratorUrl).toBe('http://collab:3078')
    expect(config.AllowDefaultSecret).toBe(false)
  })
})
