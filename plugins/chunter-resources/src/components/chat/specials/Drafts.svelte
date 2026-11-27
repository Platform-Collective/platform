<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import activity, { type ActivityMessage } from '@hcengineering/activity'
  import { Analytics } from '@hcengineering/analytics'
  import { type Doc, type Ref } from '@hcengineering/core'
  import { type DocNotifyContext } from '@hcengineering/notification'
  import { type ChunterSpace } from '@hcengineering/chunter'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import { draftsStore, getClient } from '@hcengineering/presentation'
  import { Label, Scroller } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { getObjectLinkId } from '@hcengineering/view-resources'

  import chunter from '../../../plugin'
  import { getChatDrafts, type ChatDraftTarget } from '../../../chat-drafts'
  import { openChannel, openThreadInSidebar } from '../../../navigation'
  import { getChannelName } from '../../../utils'
  import Header from '../../Header.svelte'

  interface DraftRow {
    draft: ChatDraftTarget
    object: Doc
    title: string
    thread?: Ref<ActivityMessage>
  }

  const client = getClient()
  const contexts = InboxNotificationsClientImpl.getClient().contexts
  const providers = client.getModel().findAllSync(view.mixin.LinkIdProvider, {})
  let rows: DraftRow[] = []
  let generation = 0
  let previous = ''
  let loaded = false

  // Content changes do not require another lookup of the same destinations.
  $: void loadRows(getChatDrafts($draftsStore), $contexts)

  async function loadRows(drafts: ChatDraftTarget[], available: DocNotifyContext[]): Promise<void> {
    const signature = JSON.stringify([drafts, available.map(({ objectId, objectClass }) => [objectId, objectClass])])
    if (signature === previous) return
    previous = signature
    const current = ++generation
    rows = []
    loaded = false
    const result: DraftRow[] = []
    for (const draft of drafts) {
      try {
        const parent = draft.thread
          ? await client.findOne(activity.class.ActivityMessage, { _id: draft.target as Ref<ActivityMessage> })
          : undefined
        if (draft.thread && parent === undefined) continue
        const context = available.find(({ objectId }) => objectId === draft.target)
        const object =
          parent !== undefined
            ? await client.findOne(parent.attachedToClass, { _id: parent.attachedTo })
            : context !== undefined
              ? await client.findOne(context.objectClass, { _id: context.objectId })
              : await client.findOne(chunter.class.ChunterSpace, { _id: draft.target as Ref<ChunterSpace> })
        if (object === undefined) continue
        const title = await getChannelName(object._id, object._class, object)
        if (title === undefined) continue
        result.push({ draft, object, title, thread: parent?._id })
      } catch (error) {
        Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (current === generation) {
      rows = result
      loaded = true
    }
  }

  async function resume(row: DraftRow): Promise<void> {
    try {
      const id = await getObjectLinkId(providers, row.object._id, row.object._class, row.object)
      if (row.thread !== undefined) {
        await openThreadInSidebar(row.thread, undefined, row.object)
      }
      openChannel(id, row.object._class, row.thread, true)
    } catch (error) {
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }
</script>

<Header icon={view.icon.Edit} intlLabel={chunter.string.Drafts} titleKind={'breadcrumbs'} />
<Scroller padding={'.75rem .5rem'}>
  <p class="hint"><Label label={chunter.string.DraftsLocal} /></p>
  {#each rows as row (row.draft.key)}
    <button class="draft-row" data-draft-target={row.draft.target} on:click={() => resume(row)}>
      <span>{row.title}</span>
      {#if row.draft.thread}<span class="hint"><Label label={chunter.string.Thread} /></span>{/if}
    </button>
  {:else}
    {#if loaded}<p class="hint" data-drafts-empty><Label label={chunter.string.NoDrafts} /></p>{/if}
  {/each}
</Scroller>

<style lang="scss">
  .hint {
    color: var(--global-secondary-TextColor);
    padding: var(--spacing-1_5);
  }

  .draft-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--spacing-2);
    border-radius: var(--small-BorderRadius);
    text-align: start;

    &:hover {
      background: var(--global-ui-highlight-BackgroundColor);
    }
  }
</style>
