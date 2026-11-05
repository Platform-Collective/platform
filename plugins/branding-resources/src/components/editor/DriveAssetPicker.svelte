<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { Ref } from '@hcengineering/core'
  import type { BrandAssetKind } from '@hcengineering/branding'
  import drive, { type Drive, type File as DriveFile, type FileVersion } from '@hcengineering/drive'
  import { createQuery, getClient, getFileUrl } from '@hcengineering/presentation'
  import { Button, Label, Loading, Scroller, SearchEdit } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { getAssetKind, importStoredAsset } from '../../assets'
  import branding from '../../plugin'

  export let kind: BrandAssetKind = 'image'

  const dispatch = createEventDispatcher<{ close: number | undefined }>()
  const client = getClient()

  interface Candidate {
    file: DriveFile
    version: FileVersion
    driveName: string
  }

  let files: DriveFile[] = []
  let versions = new Map<Ref<FileVersion>, FileVersion>()
  let drives = new Map<Ref<Drive>, string>()
  let loading = true
  let search = ''
  let picked = new Set<Ref<DriveFile>>()
  let importing = false
  let error: string | undefined

  const filesQuery = createQuery()
  filesQuery.query(
    drive.class.File,
    {},
    (res) => {
      files = res
      void loadVersions(res)
    },
    { sort: { modifiedOn: -1 }, limit: 1000 }
  )

  const drivesQuery = createQuery()
  drivesQuery.query(drive.class.Drive, {}, (res) => {
    drives = new Map(res.map((d) => [d._id, d.name]))
  })

  // The file points to its current version, which holds the blob and its content type
  async function loadVersions (list: DriveFile[]): Promise<void> {
    const ids = list.map((f) => f.file)
    const result = ids.length > 0 ? await client.findAll(drive.class.FileVersion, { _id: { $in: ids } }) : []
    versions = new Map(result.map((v) => [v._id, v]))
    loading = false
  }

  $: candidates = files
    .map((file): Candidate | undefined => {
      const version = versions.get(file.file)
      if (version === undefined) return undefined
      if (getAssetKind({ name: file.title, type: version.type }) !== kind) return undefined
      return { file, version, driveName: drives.get(file.space) ?? '' }
    })
    .filter((c): c is Candidate => c !== undefined)
    .filter((c) => search.trim() === '' || c.file.title.toLowerCase().includes(search.trim().toLowerCase()))

  function toggle (id: Ref<DriveFile>): void {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    picked = next
  }

  async function importPicked (): Promise<void> {
    importing = true
    error = undefined
    let count = 0
    try {
      for (const c of candidates.filter((c) => picked.has(c.file._id))) {
        await importStoredAsset(client, {
          name: c.file.title,
          file: c.version.file,
          type: c.version.type,
          size: c.version.size
        })
        count++
      }
      dispatch('close', count)
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      Analytics.handleError(e)
      error = e.message
    } finally {
      importing = false
    }
  }
</script>

<div class="antiPopup picker">
  <div class="header">
    <span class="title"><Label label={branding.string.ImportFromDrive} /></span>
    <SearchEdit bind:value={search} width={'12rem'} />
  </div>
  <Scroller>
    {#if loading}
      <Loading />
    {:else if candidates.length === 0}
      <div class="empty">
        <Label label={kind === 'image' ? branding.string.NoDriveImages : branding.string.NoDriveFonts} />
      </div>
    {:else if kind === 'image'}
      <div class="grid">
        {#each candidates as c (c.file._id)}
          <button
            type="button"
            class="tile"
            class:picked={picked.has(c.file._id)}
            title={c.driveName !== '' ? `${c.driveName} / ${c.file.title}` : c.file.title}
            on:click={() => toggle(c.file._id)}
          >
            <span class="preview"><img src={getFileUrl(c.version.file, c.file.title)} alt={c.file.title} /></span>
            <span class="name overflow-label">{c.file.title}</span>
            {#if c.driveName !== ''}<span class="drive overflow-label">{c.driveName}</span>{/if}
            <span class="check">{picked.has(c.file._id) ? '✓' : ''}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="list">
        {#each candidates as c (c.file._id)}
          <label class="row">
            <input type="checkbox" checked={picked.has(c.file._id)} on:change={() => toggle(c.file._id)} />
            <span class="name overflow-label">{c.file.title}</span>
            <span class="drive overflow-label">{c.driveName}</span>
          </label>
        {/each}
      </div>
    {/if}
  </Scroller>
  <div class="footer">
    {#if error !== undefined}<span class="error overflow-label">{error}</span>{/if}
    <span class="count"><Label label={branding.string.SelectedCount} params={{ count: picked.size }} /></span>
    <Button label={branding.string.Cancel} size={'medium'} on:click={() => dispatch('close', undefined)} />
    <Button
      label={branding.string.ImportSelected}
      kind={'primary'}
      size={'medium'}
      disabled={picked.size === 0}
      loading={importing}
      on:click={importPicked}
    />
  </div>
</div>

<style lang="scss">
  .picker {
    display: flex;
    flex-direction: column;
    width: 40rem;
    max-width: 92vw;
    height: 32rem;
    max-height: 85vh;
  }
  .header,
  .footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
  }
  .header {
    justify-content: space-between;
    border-bottom: 1px solid var(--theme-popup-divider);
  }
  .footer {
    justify-content: flex-end;
    border-top: 1px solid var(--theme-popup-divider);

    .count {
      margin-right: auto;
      font-size: 0.8125rem;
      color: var(--theme-dark-color);
    }
    .error {
      max-width: 14rem;
      font-size: 0.75rem;
      color: var(--theme-error-color);
    }
  }
  .title {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: 0.5rem;
    padding: 0.75rem;
  }
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.125rem;
    min-width: 0;
    padding: 0 0 0.375rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-button-default);
    overflow: hidden;
    cursor: pointer;
    text-align: left;

    &:hover {
      border-color: var(--theme-button-border);
    }
    &.picked {
      border-color: var(--primary-button-default);
      box-shadow: 0 0 0 1px var(--primary-button-default);
    }
    .preview {
      display: block;
      height: 5.5rem;
      padding: 0.25rem;
      background: repeating-conic-gradient(#f2f4f7 0% 25%, #fff 0% 50%) 50% / 1rem 1rem;

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
    }
    .name {
      padding: 0 0.375rem;
      font-size: 0.75rem;
      color: var(--theme-caption-color);
    }
    .drive {
      padding: 0 0.375rem;
      font-size: 0.6875rem;
      color: var(--theme-dark-color);
    }
    .check {
      position: absolute;
      top: 0.25rem;
      right: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 50%;
      font-size: 0.75rem;
      color: #fff;
    }
    &.picked .check {
      background: var(--primary-button-default);
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--theme-divider-color);
    cursor: pointer;

    input {
      accent-color: var(--primary-button-default);
    }
    .name {
      flex-grow: 1;
      color: var(--theme-caption-color);
    }
    .drive {
      font-size: 0.75rem;
      color: var(--theme-dark-color);
    }
  }
</style>
