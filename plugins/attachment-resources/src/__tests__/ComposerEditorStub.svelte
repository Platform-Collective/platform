<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { EmptyMarkup, isEmptyMarkup, jsonToMarkup, markupToJSON, MarkupNodeType } from '@hcengineering/text'
  import type { EditorKitOptions } from '@hcengineering/text-editor-resources'
  import { inserted } from './inline-image-fixture'

  export let content = EmptyMarkup
  export let kitOptions: Partial<EditorKitOptions>
  export let onPaste: (view: unknown, event: ClipboardEvent) => boolean
  const dispatch = createEventDispatcher<{ content: string, update: string }>()

  $: if (typeof kitOptions.hooks === 'object' && typeof kitOptions.hooks.emptyContent === 'object') {
    kitOptions.hooks.emptyContent.onChange?.(isEmptyMarkup(content))
  }

  export function setContent(): void {}
  export function clear(): void {
    content = EmptyMarkup
  }
  export function submit(): void {
    dispatch('content', content)
  }
  export function insertMarkup(markup: string): void {
    inserted.push(markup)
    content = jsonToMarkup({
      type: MarkupNodeType.doc,
      content: [...(markupToJSON(content).content ?? []), markupToJSON(markup)]
    })
    dispatch('update', content)
  }
</script>

<!-- Leave descendant drop handling observable, like ProseMirror's own handlers. -->
<div on:paste={(event) => onPaste({}, event)}>
  <textarea
    value={content}
    on:input={(event) => {
      content = event.currentTarget.value
      dispatch('update', content)
    }}
    on:keydown={(event) => {
      if (event.key === 'Enter') submit()
    }}
  />
</div>
