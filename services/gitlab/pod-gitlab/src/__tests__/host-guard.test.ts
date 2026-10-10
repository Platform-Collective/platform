// SPDX-License-Identifier: EPL-2.0
import { GitlabHostRefusedError, HostGuard, isPublicAddress, type LookupFn } from '../host-guard'

function resolves (map: Record<string, string[]>): jest.Mock & LookupFn {
  return jest.fn(async (hostname: string) => {
    const addresses = map[hostname]
    if (addresses === undefined) throw new Error(`ENOTFOUND ${hostname}`)
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }) as jest.Mock & LookupFn
}

const open = { allowInsecure: false, allowedHosts: [] }

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
    '::ffff:0:8.8.8.8',
    '2001:0:4136:e378:8000:63bf:f7f7:f7f7'
  ])('accepts %p', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:127.0.0.1',
    '::10.0.0.1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    '64:ff9b:1::a00:1',
    'fec0::1',
    '::ffff:0:7f00:1',
    '::ffff:0:10.0.0.1',
    // Teredo: client IPv4 127.0.0.1 is the bitwise NOT of the last 32 bits (80ff:fffe)
    '2001:0:4136:e378:8000:63bf:80ff:fffe',
    'not-an-address'
  ])('refuses %p', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })
})

describe('HostGuard', () => {
  it('accepts a host whose every address is public', async () => {
    const lookup = resolves({ 'gitlab.example.com': ['93.184.216.34', '2606:4700::1111'] })
    await new HostGuard(open, lookup).assertAllowed('https://gitlab.example.com/sub/api/v4/user')
    expect(lookup).toHaveBeenCalledWith('gitlab.example.com')
  })

  it('refuses a host with any private address (split-horizon DNS)', async () => {
    const lookup = resolves({ 'gitlab.example.com': ['93.184.216.34', '10.0.0.5'] })
    await expect(new HostGuard(open, lookup).assertAllowed('https://gitlab.example.com')).rejects.toBeInstanceOf(
      GitlabHostRefusedError
    )
  })

  it('refuses IP literals in private ranges without a lookup', async () => {
    const lookup = resolves({})
    const guard = new HostGuard(open, lookup)
    for (const url of [
      'https://169.254.169.254',
      'https://[::1]:8443',
      'https://127.0.0.1/x',
      'https://[::ffff:a00:1]'
    ]) {
      await expect(guard.assertAllowed(url)).rejects.toThrow('is not allowed')
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses loopback written in the shorthand forms URL normalises', async () => {
    const lookup = resolves({ 'localhost.': ['127.0.0.1'] })
    const guard = new HostGuard(open, lookup)
    // URL turns the numeric forms into 127.0.0.1: refused as a literal, without a lookup
    for (const url of ['https://2130706433', 'https://0x7f.1', 'https://127.1']) {
      await expect(guard.assertAllowed(url)).rejects.toThrow('GitLab host 127.0.0.1 is not allowed')
    }
    expect(lookup).not.toHaveBeenCalled()
    await expect(guard.assertAllowed('https://localhost.')).rejects.toThrow('is not allowed')
    expect(lookup).toHaveBeenCalledWith('localhost.')
  })

  it('refuses a host that does not resolve, and asks again next time', async () => {
    const lookup = resolves({})
    const guard = new HostGuard(open, lookup)
    await expect(guard.assertAllowed('https://nowhere.example')).rejects.toBeInstanceOf(GitlabHostRefusedError)
    await expect(guard.assertAllowed('https://nowhere.example')).rejects.toBeInstanceOf(GitlabHostRefusedError)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('caches a resolution for a minute', async () => {
    let now = 0
    const lookup = resolves({ 'gitlab.example.com': ['93.184.216.34'] })
    const guard = new HostGuard(open, lookup, () => now)
    await guard.assertAllowed('https://gitlab.example.com')
    now += 59_000
    await guard.assertAllowed('https://gitlab.example.com/api/v4/user')
    expect(lookup).toHaveBeenCalledTimes(1)
    now += 2_000
    await guard.assertAllowed('https://gitlab.example.com')
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('with GITLAB_ALLOWED_HOSTS accepts only the listed hosts, private ones included', async () => {
    const lookup = resolves({ 'gitlab.com': ['93.184.216.34'] })
    const guard = new HostGuard({ allowInsecure: false, allowedHosts: ['git.corp.internal'] }, lookup)
    await guard.assertAllowed('https://git.corp.internal')
    await guard.assertAllowed('https://GIT.corp.internal/gitlab')
    await expect(guard.assertAllowed('https://gitlab.com')).rejects.toBeInstanceOf(GitlabHostRefusedError)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('accepts any host in dev mode (GITLAB_ALLOW_INSECURE_HOSTS)', async () => {
    const lookup = resolves({})
    await new HostGuard({ allowInsecure: true, allowedHosts: [] }, lookup).assertAllowed('http://huly.local:8080')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses something that is not a URL without echoing it', async () => {
    const input = 'http://user:secret@[bad'
    expect(() => new URL(input)).toThrow()
    const lookup = resolves({})
    const err = await new HostGuard(open, lookup).assertAllowed(input).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitlabHostRefusedError)
    expect((err as GitlabHostRefusedError).host).toBe('(invalid URL)')
    expect((err as Error).message).not.toContain('secret')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses non-http redirect targets even in dev mode', async () => {
    const guard = new HostGuard({ allowInsecure: true, allowedHosts: [] }, resolves({}))
    for (const url of ['data:text/html,x', 'file:///etc/passwd', 'ftp://gitlab.local/x', 'javascript:alert(1)']) {
      await expect(guard.assertRedirectAllowed(url)).rejects.toBeInstanceOf(GitlabHostRefusedError)
    }
    await expect(guard.assertRedirectAllowed('http://gitlab.local/uploads/x')).resolves.toBeUndefined()
    await expect(guard.assertRedirectAllowed('https://store.example.com/x')).resolves.toBeUndefined()
  })
})
