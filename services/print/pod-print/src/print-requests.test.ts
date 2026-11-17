// SPDX-License-Identifier: EPL-2.0

import dns from 'dns'
import { createPrintRequestChecker } from './print-url'

function mockDns (addresses: Array<{ address: string, family: number }>): jest.SpyInstance {
  // lookup's overload types describe the single-address result; safe-fetch requests all records.
  return jest.spyOn(dns.promises, 'lookup').mockResolvedValue(addresses as unknown as dns.LookupAddress)
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('print subresource policy', () => {
  it('rejects a hostname if any DNS address is private', async () => {
    const lookup = mockDns([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 }
    ])
    const check = createPrintRequestChecker(['https://front.example:8443'])
    expect(await check('https://images.example/image.png')).toBe(false)
    expect(await check('https://images.example/another.png')).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('shares successful lookups only within a render', async () => {
    const lookup = mockDns([{ address: '93.184.216.34', family: 4 }])
    const check = createPrintRequestChecker([])
    expect(await check('https://images.example/a.png')).toBe(true)
    expect(await check('https://images.example/b.png')).toBe(true)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(await createPrintRequestChecker([])('https://images.example/c.png')).toBe(true)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('trusts private hosts only at their configured origin or port', async () => {
    const lookup = mockDns([{ address: '10.0.0.1', family: 4 }])
    const check = createPrintRequestChecker(['http://front:8080'])
    expect(await check('http://front:8080/app.js')).toBe(true)
    expect(lookup).not.toHaveBeenCalled()
    expect(await check('http://front:9200/image')).toBe(false)
    expect(await check('https://front:8080/image')).toBe(false)
  })

  it.each([
    'http://169.254.169.254/image',
    'http://[::1]/image',
    'http://localhost:9200/image',
    'http://user:pass@images.example/image',
    'file:///etc/passwd',
    'invalid'
  ])('blocks unsafe URLs before DNS: %s', async (url) => {
    const lookup = mockDns([{ address: '93.184.216.34', family: 4 }])
    expect(await createPrintRequestChecker([])(url)).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('fails closed when DNS fails', async () => {
    mockDns([]).mockRejectedValue(new Error('lookup failed'))
    expect(await createPrintRequestChecker([])('https://images.example/image')).toBe(false)
  })
})
