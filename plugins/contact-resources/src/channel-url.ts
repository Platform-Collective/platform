// SPDX-License-Identifier: EPL-2.0

import contact, { type Channel } from '@hcengineering/contact'
import { parseURL } from '@hcengineering/ui'
import { getChannelProviderUrl } from './channelUrl'

/** Returns the external URL for a contact channel. */
export function getChannelURL (channel: Pick<Channel, 'provider' | 'value'>): string | undefined {
  const value = channel.value.trim()
  if (value === '') return

  // Phone numbers, e-mail addresses and nicknames are validated by getChannelProviderUrl,
  // e.g. an e-mail with ?, & or # cannot inject extra mailto: fields such as bcc.
  if (channel.provider === contact.channelProvider.Phone) {
    return getChannelProviderUrl(channel.provider, value.replace(/^tel:/i, ''))
  }
  if (channel.provider === contact.channelProvider.Email) {
    return getChannelProviderUrl(channel.provider, value)
  }
  const providerUrl = getChannelProviderUrl(channel.provider, value)
  if (providerUrl !== undefined) return providerUrl

  const url = parseURL(value)
  return url.startsWith('http://') || url.startsWith('https://') ? url : undefined
}

/** Opens a channel URL: web links in a new tab, tel: and mailto: links in the system handler without a new tab. */
export function openChannelLink (url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    window.open(url)
  } else {
    window.open(url, '_self')
  }
}
