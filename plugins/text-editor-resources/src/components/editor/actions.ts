import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import emojiPlugin from '@hcengineering/emoji'
import gifPlugin, { isGifResult } from '@hcengineering/gif'
import textEditor, { type RefAction } from '@hcengineering/text-editor'

import RiMention from '../icons/RIMention.svelte'

export const defaultRefActions: RefAction[] = [
  {
    label: textEditor.string.Mention,
    icon: RiMention,
    action: (_element, editorHandler) => {
      editorHandler.insertText('@')
      editorHandler.focus()
    },
    order: 3000
  },
  {
    label: textEditor.string.Emoji,
    icon: emojiPlugin.icon.Emoji,
    action: (element, editorHandler) => {
      showPopup(
        gifPlugin.component.GifPickerPopup,
        {},
        element,
        (result) => {
          if (result === null || result === undefined) {
            return
          }
          // Two shapes come back from one popup and nothing type-checks this: showPopup's
          // callback is (result: any) => void. Hence the runtime guard.
          if (isGifResult(result)) {
            editorHandler.insertGif(result)
          } else {
            editorHandler.insertEmoji(result.text, result.image)
          }
          editorHandler.focus()
        },
        () => {}
      )
    },
    order: 4001
  }
]

export async function getModelRefActions (): Promise<RefAction[]> {
  const client = getClient()

  const actions: RefAction[] = []

  const items = await client.findAll(textEditor.class.RefInputActionItem, {})
  for (const item of items) {
    actions.push({
      label: item.label,
      icon: item.icon,
      order: item.order ?? 10000,
      action: await getResource(item.action)
    })
  }

  return actions
}
