// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import { parseURL } from '@hcengineering/ui'
import { getChannelURL } from './channel-url'

jest.mock('@hcengineering/ui', () => ({ parseURL: jest.fn() }))

describe('getChannelURL', () => {
  beforeEach(() => {
    jest.mocked(parseURL).mockReset()
    jest.mocked(parseURL).mockImplementation((value) => (/^https?:\/\//.test(value) ? value : ''))
  })

  it.each([
    [contact.channelProvider.GitHub, 'https://github.com/huly'],
    [contact.channelProvider.Twitter, 'https://twitter.com/huly'],
    [contact.channelProvider.Telegram, 'https://t.me/huly']
  ])('opens nicknames for %s', (provider, expected) => {
    for (const value of ['huly', '@huly', ' @huly ']) {
      expect(getChannelURL({ provider, value })).toBe(expected)
    }
  })

  it.each([
    [contact.channelProvider.GitHub, '@huly-platform', 'https://github.com/huly-platform'],
    [contact.channelProvider.Telegram, '@huly_platform', 'https://t.me/huly_platform']
  ])('supports nickname punctuation for %s', (provider, value, expected) => {
    expect(getChannelURL({ provider, value })).toBe(expected)
  })

  it.each([
    [contact.channelProvider.GitHub, 'https://github.com/huly'],
    [contact.channelProvider.Twitter, 'https://x.com/huly'],
    [contact.channelProvider.Telegram, 'https://t.me/huly'],
    [contact.channelProvider.Homepage, 'https://example.com/profile'],
    [contact.channelProvider.LinkedIn, 'http://www.linkedin.com/in/huly']
  ])('preserves web links for %s', (provider, value) => {
    expect(getChannelURL({ provider, value })).toBe(value)
  })

  it.each(['person@example.com', 'mailto:person@example.com', ' person@example.com '])(
    'opens email %s in the mail client',
    (value) => {
      expect(getChannelURL({ provider: contact.channelProvider.Email, value })).toBe('mailto:person@example.com')
    }
  )

  it.each(['+123456789', 'tel:+123456789', ' +123 456 789 '])('opens phone %s in the dialer', (value) => {
    expect(getChannelURL({ provider: contact.channelProvider.Phone, value })).toBe('tel:+123456789')
  })

  it('uses the existing URL parser for bare domains', () => {
    jest.mocked(parseURL).mockReturnValue('http://github.com/huly')
    expect(getChannelURL({ provider: contact.channelProvider.GitHub, value: 'github.com/huly' })).toBe(
      'http://github.com/huly'
    )
    expect(parseURL).toHaveBeenCalledWith('github.com/huly')
  })

  it.each(Object.values(contact.channelProvider))('ignores empty values for %s', (provider) => {
    expect(getChannelURL({ provider, value: '   ' })).toBeUndefined()
  })

  it.each([
    [contact.channelProvider.Email, 'mailto: '],
    [contact.channelProvider.Phone, 'tel: ']
  ])('ignores empty addresses for %s', (provider, value) => {
    expect(getChannelURL({ provider, value })).toBeUndefined()
  })

  it.each(['@', 'not a username', 'javascript:alert(1)', 'data:text/html,test'])(
    'ignores invalid value %s',
    (value) => {
      expect(getChannelURL({ provider: contact.channelProvider.Telegram, value })).toBeUndefined()
    }
  )

  it('does not open unsupported URL schemes from the URL parser', () => {
    jest.mocked(parseURL).mockReturnValue('ftp://example.com')
    expect(getChannelURL({ provider: contact.channelProvider.Homepage, value: 'ftp://example.com' })).toBeUndefined()
  })
})
