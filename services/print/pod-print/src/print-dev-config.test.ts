// SPDX-License-Identifier: EPL-2.0

import dns from 'dns'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createPrintRequestChecker, getPrintHostnames } from './print-url'

// Read only the literal list-style environment entries for the named dev service.
function devEnvironment (service: string): Map<string, string> {
  const lines = readFileSync(resolve(__dirname, '../../../../dev/docker-compose.yaml'), 'utf8').split('\n')
  const start = lines.indexOf(`  ${service}:`)
  if (start < 0) throw new Error('Missing dev service')
  let end = start + 1
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:/.test(lines[end])) end++
  const entries = lines.slice(start + 1, end).flatMap((line) => {
    const match = line.match(/^\s+-\s+([A-Z][A-Z0-9_]*)=(.*)$/)
    return match === null ? [] : [[match[1], match[2]] as [string, string]]
  })
  return new Map(entries)
}

const front = devEnvironment('front')
const print = devEnvironment('print')
const services = [...front].filter(([key, value]) => key.endsWith('_URL') && /^https?:\/\//.test(value))

afterEach(() => {
  jest.restoreAllMocks()
})

it('finds the front end backend URL configuration', () => {
  expect(services.length >= 5).toBe(true)
})

it.each(services)('allows the configured dev backend %s when DNS is private', async (_key, url) => {
  jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as unknown as dns.LookupAddress)
  const allowed = getPrintHostnames((print.get('ALLOWED_HOSTNAMES') ?? '').split(','), print.get('FRONT_URL') ?? '')
  const check = createPrintRequestChecker(allowed)
  expect(await check(url)).toBe(true)
  expect(await check('http://huly.local:65530/not-configured')).toBe(false)
})
