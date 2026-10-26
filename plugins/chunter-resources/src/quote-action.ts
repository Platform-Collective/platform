// SPDX-License-Identifier: EPL-2.0

import { type ChatMessage } from '@hcengineering/chunter'
import { getName } from '@hcengineering/contact'
import { getPersonByPersonId, getSocialIdByPersonId } from '@hcengineering/contact-resources'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { isElementFromSidebar } from '@hcengineering/workbench-resources'
import { get } from 'svelte/store'

import { getMessageLink } from './navigation'
import { buildQuoteMarkup } from './quote'
import { activeQuoteInputStore, quoteInputsStore, type QuoteInput } from './stores'
import { isThreadMessage } from './utils'

/** Registers a channel composer, excluding thread and message editing inputs. */
export function registerQuoteInput (input: QuoteInput): () => void {
  quoteInputsStore.update((inputs) => inputs.add(input))
  // Remember the source composer when a context menu opens outside the channel.
  const activate = (): void => {
    activeQuoteInputStore.set(input)
  }
  input.element?.addEventListener('pointerdown', activate, true)
  input.element?.addEventListener('contextmenu', activate, true)

  return () => {
    input.element?.removeEventListener('pointerdown', activate, true)
    input.element?.removeEventListener('contextmenu', activate, true)
    if (get(activeQuoteInputStore) === input) activeQuoteInputStore.set(undefined)
    quoteInputsStore.update((inputs) => {
      inputs.delete(input)
      return inputs
    })
  }
}

function getQuoteInputs (message: ChatMessage): QuoteInput[] {
  const objectId = isThreadMessage(message) ? message.objectId : message.attachedTo
  return Array.from(get(quoteInputsStore)).filter((input) => input.objectId === objectId)
}

export async function canQuoteMessage (message?: ChatMessage | ChatMessage[]): Promise<boolean> {
  return message !== undefined && !Array.isArray(message) && getQuoteInputs(message).length > 0
}

export async function quoteMessage (message: ChatMessage, event?: Event): Promise<void> {
  const inputs = getQuoteInputs(message)
  const fromSidebar = event?.target != null && isElementFromSidebar(event.target as HTMLElement)
  const activeInput = get(activeQuoteInputStore)
  const input =
    inputs.find((input) => event?.target != null && input.element?.contains(event.target as Node)) ??
    inputs.find((input) => input === activeInput) ??
    inputs.find((input) => input.isSidebar === fromSidebar) ??
    inputs[0]
  if (input === undefined) return

  try {
    const [person, socialId, link] = await Promise.all([
      message.createdBy !== undefined ? getPersonByPersonId(message.createdBy) : undefined,
      message.createdBy !== undefined ? getSocialIdByPersonId(message.createdBy) : undefined,
      getMessageLink(message)
    ])
    const author = person != null ? getName(getClient().getHierarchy(), person) : (socialId?.value ?? '')

    if (get(quoteInputsStore).has(input)) {
      input.appendMarkup(buildQuoteMarkup(message.message, author, link))
    }
  } catch (err: unknown) {
    void setPlatformStatus(unknownError(err))
  }
}
