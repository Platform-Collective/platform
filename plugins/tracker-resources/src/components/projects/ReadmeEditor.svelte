<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { MessageViewer } from '@hcengineering/presentation'
  import { StyledTextArea } from '@hcengineering/text-editor-resources'
  import { isEmptyMarkup } from '@hcengineering/text'
  import { Label, TabList, type TabItem } from '@hcengineering/ui'

  import tracker from '../../plugin'

  // The README of a project (GitHub: Markdown with a preview). The text is the Markup of the platform editor, which
  // takes Markdown shortcuts and pasted Markdown; the preview is the same viewer the project details use.
  export let value: string | undefined

  let mode: 'write' | 'preview' = 'write'

  const items: TabItem[] = [
    {
      id: 'write',
      labelIntl: tracker.string.ProjectReadmeWrite,
      action: () => {
        mode = 'write'
      }
    },
    {
      id: 'preview',
      labelIntl: tracker.string.ProjectReadmePreview,
      action: () => {
        mode = 'preview'
      }
    }
  ]
</script>

<div class="readme">
  <TabList {items} selected={mode} kind={'plain'} size={'small'} />
  {#if mode === 'write'}
    <StyledTextArea
      bind:content={value}
      placeholder={tracker.string.ProjectReadmePlaceholder}
      kind={'emphasized'}
      showButtons={false}
      maxHeight={'20rem'}
    />
  {:else}
    <div class="preview" data-id="readme-preview">
      {#if value !== undefined && !isEmptyMarkup(value)}
        <MessageViewer message={value} />
      {:else}
        <span class="content-dark-color"><Label label={tracker.string.ProjectReadmeEmpty} /></span>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .readme {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .preview {
    min-height: 8rem;
    padding: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    overflow: auto;
  }
</style>
