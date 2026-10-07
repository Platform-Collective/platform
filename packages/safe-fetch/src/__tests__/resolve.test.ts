// SPDX-License-Identifier: EPL-2.0

import { resolveAndCheck } from '../resolve'
import { type Lookup, SafeFetchError } from '../safe-fetch-types'

async function codeOf (promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code
    throw err
  }
  return undefined
}

const table: Record<string, Array<{ address: string, family: 4 | 6 }>> = {
  'public.example': [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
  ],
  'mixed.example': [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 }
  ],
  'private.example': [{ address: '192.168.0.10', family: 4 }],
  'metadata.example': [{ address: '169.254.169.254', family: 4 }],
  'empty.example': []
}

const lookup: Lookup = async (hostname) => {
  const found = table[hostname]
  if (found === undefined) throw new Error('ENOTFOUND')
  return found
}

describe('resolveAndCheck', () => {
  it('returns every address of a public hostname', async () => {
    const result = await resolveAndCheck('Public.Example.', { lookup })
    expect(result.map((a) => a.address)).toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])
  })

  it('rejects a hostname when any address is blocked', async () => {
    expect(await codeOf(resolveAndCheck('mixed.example', { lookup }))).toBe('BLOCKED_ADDRESS')
    expect(await codeOf(resolveAndCheck('private.example', { lookup }))).toBe('BLOCKED_ADDRESS')
    expect(await codeOf(resolveAndCheck('metadata.example', { lookup }))).toBe('BLOCKED_ADDRESS')
  })

  it('fails on unknown or empty names', async () => {
    expect(await codeOf(resolveAndCheck('missing.example', { lookup }))).toBe('FETCH_FAILED')
    expect(await codeOf(resolveAndCheck('empty.example', { lookup }))).toBe('FETCH_FAILED')
  })

  it('skips the address check for an allowlisted hostname', async () => {
    const result = await resolveAndCheck('private.example', { lookup, allowlist: ['private.example'] })
    expect(result[0].address).toBe('192.168.0.10')
    const wildcard = await resolveAndCheck('private.example', { lookup, allowlist: ['*.example'] })
    expect(wildcard[0].address).toBe('192.168.0.10')
  })

  it('admits private addresses through a CIDR allowlist entry', async () => {
    const result = await resolveAndCheck('private.example', { lookup, allowlist: ['192.168.0.0/24'] })
    expect(result[0].address).toBe('192.168.0.10')
    expect(await codeOf(resolveAndCheck('private.example', { lookup, allowlist: ['192.168.1.0/24'] }))).toBe(
      'BLOCKED_ADDRESS'
    )
  })

  it('checks IP literals without consulting DNS', async () => {
    const neverCalled: Lookup = async () => {
      throw new Error('lookup must not be called for literals')
    }
    expect(await resolveAndCheck('8.8.8.8', { lookup: neverCalled })).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(await codeOf(resolveAndCheck('10.0.0.1', { lookup: neverCalled }))).toBe('BLOCKED_ADDRESS')
  })
})
