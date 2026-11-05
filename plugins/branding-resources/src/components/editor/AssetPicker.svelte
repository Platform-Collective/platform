<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { BrandAsset, BrandAssetKind } from '@hcengineering/branding'
  import { createQuery, getClient, getFileUrl } from '@hcengineering/presentation'
  import { Button, IconAdd, IconDelete, Label, Loading, Scroller, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import drive from '@hcengineering/drive'
  import { FONT_ACCEPT, IMAGE_ACCEPT, uploadBrandAsset } from '../../assets'
  import DriveAssetPicker from './DriveAssetPicker.svelte'
  import branding from '../../plugin'

  export let kind: BrandAssetKind = 'image'
  // Management mode lists assets without picking one
  export let manage: boolean = false
  // Rendered inside a page instead of a popup
  export let embedded: boolean = false

  const dispatch = createEventDispatcher<{ close: BrandAsset | undefined }>()
  const client = getClient()
  const query = createQuery()

  let assets: BrandAsset[] = []
  let loading = true
  let uploading = false
  let input: HTMLInputElement

  $: query.query(branding.class.BrandAsset, { kind }, (res) => {
    assets = res
    loading = false
  }, { sort: { modifiedOn: -1 } })

  async function onFiles (e: Event): Promise<void> {
    const files = Array.from((e.target as HTMLInputElement).files ?? [])
    uploading = true
    try {
      for (const file of files) {
        await uploadBrandAsset(client, file)
      }
    } catch (err: unknown) {
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      uploading = false
      input.value = ''
    }
  }

  async function remove (asset: BrandAsset): Promise<void> {
    await client.remove(asset)
  }
</script>

<div class="picker" class:antiPopup={!embedded} class:embedded>
  <div class="header">
    <span class="title"><Label label={kind === 'image' ? branding.string.Image : branding.string.Fonts} /></span>
    <div class="grow" />
    <Button
      icon={drive.icon.Drive}
      label={branding.string.FromDrive}
      kind={'regular'}
      size={'small'}
      on:click={(e) => {
        showPopup(DriveAssetPicker, { kind }, 'top')
        e.stopPropagation()
      }}
    />
    <Button
      icon={IconAdd}
      label={branding.string.UploadAsset}
      kind={'primary'}
      size={'small'}
      loading={uploading}
      on:click={() => input.click()}
    />
    <input
      bind:this={input}
      type="file"
      multiple
      accept={kind === 'image' ? IMAGE_ACCEPT : FONT_ACCEPT}
      style="display:none"
      on:change={onFiles}
    />
  </div>
  <Scroller>
    {#if loading}
      <Loading />
    {:else if assets.length === 0}
      <div class="empty"><Label label={branding.string.NoAssets} /></div>
    {:else if kind === 'image'}
      <div class="grid">
        {#each assets as asset (asset._id)}
          <div class="tile" class:pickable={!manage} title={asset.name}>
            <button
              class="preview"
              type="button"
              disabled={manage}
              on:click={() => {
                dispatch('close', asset)
              }}
            >
              <img src={getFileUrl(asset.file, asset.name)} alt={asset.name} />
            </button>
            <div class="name">
              <span class="overflow-label">{asset.name}</span>
              <button class="remove" type="button" on:click={() => remove(asset)}><IconDelete size={'small'} /></button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="list">
        {#each assets as asset (asset._id)}
          <div class="font-row">
            <span class="family">{asset.fontFamily ?? asset.name}</span>
            <span class="file overflow-label">{asset.name}</span>
            <button class="remove" type="button" on:click={() => remove(asset)}><IconDelete size={'small'} /></button>
          </div>
        {/each}
      </div>
    {/if}
  </Scroller>
</div>

<style lang="scss">
  .picker {
    display: flex;
    flex-direction: column;
    width: 32rem;
    max-width: 90vw;
    height: 28rem;
    max-height: 80vh;

    &.embedded {
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
    }
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-popup-divider);
  }
  .grow {
    flex-grow: 1;
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
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.5rem;
    padding: 0.75rem;
  }
  .tile {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    overflow: hidden;

    &.pickable:hover {
      border-color: var(--primary-button-default);
    }
  }
  .preview {
    height: 5.5rem;
    border: none;
    padding: 0.25rem;
    background: repeating-conic-gradient(#f2f4f7 0% 25%, #fff 0% 50%) 50% / 1rem 1rem;
    cursor: pointer;

    &:disabled {
      cursor: default;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.375rem;
    font-size: 0.75rem;
    color: var(--theme-content-color);
  }
  .remove {
    margin-left: auto;
    border: none;
    background: none;
    color: var(--theme-dark-color);
    cursor: pointer;

    &:hover {
      color: var(--theme-error-color);
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
  }
  .font-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .family {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .file {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
</style>
