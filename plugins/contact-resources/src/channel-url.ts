// SPDX-License-Identifier: EPL-2.0

import contact, { type Channel } from '@hcengineering/contact'
import { parseURL } from '@hcengineering/ui'

/** Returns the external URL for a contact channel. */
export function getChannelURL (channel: Pick<Channel, 'provider' | 'value'>): string | undefined {
  const value = channel.value.trim()
  if (value === '') return

  if (channel.provider === contact.channelProvider.Email) {
    const address = value.replace(/^mailto:/i, '').trim()
    return address !== '' ? `mailto:${address}` : undefined
  }
  if (channel.provider === contact.channelProvider.Phone) {
    const number = value.replace(/^tel:/i, '').replace(/\s/g, '')
    return number !== '' ? `tel:${number}` : undefined
  }

  if (/^@?[\w-]+$/.test(value)) {
    const username = value.replace(/^@/, '')
    switch (channel.provider) {
      case contact.channelProvider.GitHub:
        return `https://github.com/${username}`
      case contact.channelProvider.Twitter:
        return `https://twitter.com/${username}`
      case contact.channelProvider.Telegram:
        return `https://t.me/${username}`
    }
  }

  const url = parseURL(value)
  return url.startsWith('http://') || url.startsWith('https://') ? url : undefined
}
