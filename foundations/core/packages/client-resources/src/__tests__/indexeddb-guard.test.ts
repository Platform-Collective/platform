//
// Copyright © 2026 Hardcore Engineering Inc.
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

// Provided by the jest runtime; this package does not include Node typings.
declare function require(id: string): unknown

describe('client-resources IndexedDB guard', () => {
  const g = globalThis as any
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(g, 'localStorage')
  const indexedDBDescriptor = Object.getOwnPropertyDescriptor(g, 'indexedDB')

  afterEach(() => {
    for (const [name, descriptor] of [
      ['localStorage', localStorageDescriptor],
      ['indexedDB', indexedDBDescriptor]
    ] as const) {
      if (descriptor !== undefined) {
        Object.defineProperty(g, name, descriptor)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete g[name]
      }
    }
  })

  it('loads without IndexedDB when localStorage is available (Node 25+)', () => {
    Object.defineProperty(g, 'localStorage', { value: {}, configurable: true, writable: true })
    delete g.indexedDB
    expect(typeof g.indexedDB).toBe('undefined')

    jest.isolateModules(() => {
      expect(() => require('../index')).not.toThrow()
    })
  })

  it('opens the model cache when IndexedDB is available', () => {
    const open = jest.fn(() => ({}))
    Object.defineProperty(g, 'indexedDB', { value: { open }, configurable: true, writable: true })

    jest.isolateModules(() => {
      require('../index')
    })
    expect(open).toHaveBeenCalledWith('model.db.persistence', 2)
  })
})
