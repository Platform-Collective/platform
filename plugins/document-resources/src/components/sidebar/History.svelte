<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
-->
<script lang="ts">
  import contact, { type PermissionsStore } from '@hcengineering/contact'
  import { Document, DocumentSnapshot } from '@hcengineering/document'
  import { getResource, setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import { addNotification, Button, Label, Lazy, Scroller, showPopup } from '@hcengineering/ui'
  import { SimpleNotification } from '@hcengineering/view-resources'
  import { onMount } from 'svelte'
  import type { Readable } from 'svelte/store'

  import document from '../../plugin'
  import { canEditDocumentContent, canRestoreSnapshot, restoreDocumentSnapshot } from '../../snapshots'
  import CreateSnapshot from '../CreateSnapshot.svelte'
  import HistoryView from './HistoryView.svelte'

  export let value: Document
  export let readonly: boolean = false

  const query = createQuery()
  const client = getClient()
  let permissionsStore: Readable<PermissionsStore> | undefined
  let restoring = false

  onMount(() => {
    void getResource(contact.store.Permissions)
      .then((store) => {
        permissionsStore = store
      })
      .catch((err) => {
        void setPlatformStatus(unknownError(err))
      })
  })

  $: canEdit = !readonly && canEditDocumentContent(client, value, $permissionsStore)

  let snapshots: DocumentSnapshot[] = []

  $: query.query(
    document.class.DocumentSnapshot,
    {
      parent: value._id
    },
    (res) => {
      snapshots = res
    },
    {
      sort: { createdOn: -1 }
    }
  )

  function takeSnapshot(): void {
    if (canEdit) showPopup(CreateSnapshot, { doc: value }, 'top')
  }

  function restore(snapshot: DocumentSnapshot): void {
    if (restoring || !canRestoreSnapshot(value, snapshot, !canEdit)) return
    const doc = value
    showPopup(
      MessageBox,
      {
        label: document.string.RestoreVersion,
        message: document.string.RestoreVersionConfirm,
        okLabel: document.string.RestoreVersion
      },
      undefined,
      async (result?: boolean) => {
        if (result !== true || restoring || !canRestoreSnapshot(value, snapshot, !canEdit)) return
        restoring = true
        try {
          const title = await translate(document.string.BeforeVersionRestore, { title: snapshot.title })
          await restoreDocumentSnapshot(client, doc, snapshot, title)
          addNotification(await translate(document.string.VersionRestored, {}), '', SimpleNotification)
        } catch (err) {
          await setPlatformStatus(unknownError(err))
        } finally {
          restoring = false
        }
      }
    )
  }
</script>

<div class="h-full flex-col clear-mins">
  <div class="header">
    <div class="title"><Label label={document.string.History} /></div>
    {#if canEdit}
      <Button
        icon={document.icon.Add}
        iconProps={{ size: 'medium' }}
        kind={'ghost'}
        showTooltip={{ label: document.string.Snapshot, direction: 'bottom' }}
        disabled={restoring}
        on:click={takeSnapshot}
      />
    {/if}
  </div>

  <div class="divider" />

  {#if snapshots.length > 0}
    <Scroller>
      {#each snapshots as snapshot}
        <Lazy>
          <HistoryView value={snapshot} readonly={!canEdit} disabled={restoring} on:restore={() => restore(snapshot)} />
        </Lazy>
      {/each}
    </Scroller>
  {:else}
    <div class="flex-col justify-center flex-grow text-center">
      <div class="label nowrap fs-bold">
        <Label label={document.string.NoHistory} />
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 1.25rem;
    height: 3rem;
    min-height: 3rem;
    border-bottom: 1px solid var(--theme-divider-color);

    .title {
      flex-grow: 1;
      font-weight: 500;
      color: var(--caption-color);
      -webkit-user-select: none;
      user-select: none;
    }
  }
</style>
