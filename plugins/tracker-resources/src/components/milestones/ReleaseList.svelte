<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { translate } from '@hcengineering/platform'
  import { Card, getClient } from '@hcengineering/presentation'
  import type { Milestone } from '@hcengineering/tracker'
  import { Button, Label, themeStore } from '@hcengineering/ui'
  import { onMount } from 'svelte'
  import { generateIssueShortLink } from '../../issues'
  import tracker from '../../plugin'
  import { formatReleaseList, loadMilestoneIssues } from './release-list'

  export let object: Milestone

  let text: string | undefined
  let count = 0
  let failed = false
  let copied = false
  let fallback = false
  let output: HTMLTextAreaElement | undefined

  onMount(() => {
    void load()
  })

  async function load(): Promise<void> {
    try {
      const issues = await loadMilestoneIssues(getClient(), object)
      const title = await translate(tracker.string.Title, {}, $themeStore.language)
      text = formatReleaseList(object.label, issues, generateIssueShortLink, ['ID', title])
      count = issues.length
    } catch {
      failed = true
    }
  }

  async function copy(): Promise<void> {
    if (text === undefined || count === 0) return
    copied = false
    fallback = false
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      fallback = true
      output?.focus()
      output?.select()
    }
  }
</script>

<Card label={tracker.string.CopyReleaseList} okAction={() => {}} hideFooter on:close on:changeContent>
  {#if failed}
    <p role="alert"><Label label={tracker.string.ReleaseListLoadFailed} /></p>
  {:else if text === undefined}
    <p role="status"><Label label={tracker.string.ReleaseListLoading} /></p>
  {:else}
    <p role="status">
      <Label
        label={count === 0 ? tracker.string.ReleaseListEmpty : tracker.string.ReleaseListCount}
        params={{ count }}
      />
    </p>
    <label class="flex-col gap-2">
      <Label label={tracker.string.ReleaseListMarkdown} />
      <textarea bind:this={output} value={text} readonly rows="10" class="release-list" />
    </label>
    <div class="flex-row-center mt-4">
      <Button
        label={tracker.string.CopyReleaseList}
        disabled={count === 0}
        on:click={() => {
          void copy()
        }}
      />
    </div>
    {#if copied}
      <p role="status"><Label label={tracker.string.ReleaseListCopied} /></p>
    {:else if fallback}
      <p role="status"><Label label={tracker.string.ReleaseListCopyFallback} /></p>
    {/if}
  {/if}
</Card>

<style lang="scss">
  .release-list {
    width: 100%;
    max-height: 40vh;
    resize: vertical;
    font-family: monospace;
    color: inherit;
    background: transparent;
  }
</style>
