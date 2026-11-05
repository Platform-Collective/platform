<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Breadcrumb, Header } from '@hcengineering/ui'

  import branding from '../plugin'
  import AssetPicker from './editor/AssetPicker.svelte'
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={branding.icon.Image} label={branding.string.ImagesAndFonts} size={'large'} isCurrent />
  </Header>
  <div class="libraries">
    <div class="library"><AssetPicker kind={'image'} manage embedded /></div>
    <div class="library"><AssetPicker kind={'font'} manage embedded /></div>
  </div>
</div>

<style lang="scss">
  .libraries {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1rem;
    flex-grow: 1;
    min-height: 0;
    padding: var(--spacing-3);
  }
  .library {
    display: flex;
    min-height: 0;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    overflow: hidden;
  }
</style>
