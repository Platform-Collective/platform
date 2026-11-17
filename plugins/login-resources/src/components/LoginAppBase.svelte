<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
// Copyright © 2026 Intabia Fusion
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
-->
<script lang="ts">
  import platform, { getMetadata } from '@hcengineering/platform'
  import { Popup, Scroller, deviceOptionsStore as deviceInfo } from '@hcengineering/ui'
  import { onMount } from 'svelte'
  import login from '../plugin'

  export let wide: boolean = false

  import { loginTheme, setLoginTheme, type LoginThemeName } from '../theme'

  onMount(() => {
    // Initialize login theme from platform metadata if provided
    const lTheme = getMetadata(login.metadata.LoginTheme) as LoginThemeName | undefined
    if (lTheme === 'huly') {
      setLoginTheme(lTheme)
    }
  })

  // activeTheme is used everywhere for rendering (prefers override if set)
  $: activeTheme = $loginTheme

  // themeStyle resolves to override theme vars when override is active, otherwise to store theme vars
  function onDevThemeChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as LoginThemeName
    // set local override and apply accent class immediately (no store change)
    setLoginTheme(v)
  }
</script>

<div
  class="w-full h-full backd"
  class:paneld={$deviceInfo.docWidth <= 768}
  class:login-theme-huly={activeTheme.name === 'huly'}
>
  <div class="bg-image clear-mins p-4">
    {#if getMetadata(platform.metadata.DevModel)}
      <div style:position="fixed" style:left={'0px'} style:top={'0px'} style:z-index={10000} class="flex-row-center">
        <select class="select small" value={$loginTheme.name} on:change={onDevThemeChange}>
          <option value="huly">Huly</option>
        </select>
      </div>
    {/if}

    {#if wide}
      <div class="panel wide">
        <Scroller padding={'1rem 0'}>
          <div class="form-content">
            <slot name="form-content" />
          </div>
          <slot name="extra-form-content" />
        </Scroller>
      </div>
    {:else}
      <div class="login-column">
        <!-- TODO(rebranding): the logo is intentionally not shown for now -->
        <div class="panel">
          <Scroller padding={'1rem 0'}>
            <div class="form-content">
              <slot name="form-content" />
            </div>
            <slot name="extra-form-content" />
          </Scroller>
        </div>
      </div>
    {/if}

    <Popup />
  </div>
</div>

<style lang="scss">
  .wide {
    position: fixed !important;
    top: 10rem !important;
    left: 2rem !important;
    right: 2rem !important;
    bottom: 2rem !important;

    transform: none !important;
    /* width: calc(100% - 4rem) !important;
    height: calc(100% - 5rem) !important; */
  }

  /* Page layout helpers */
  .backd {
    position: relative;
  }
  .bg-image {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    background-color: var(--theme-bg-color);
  }

  .fs-title {
    color: var(--theme-content-color);
  }

  /* Centered logo + card, matching the main login/signup layout. */
  .login-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 30rem;
    min-width: 0;
    gap: 1.75rem;
    padding: 2rem 1rem;
    box-sizing: border-box;
  }

  /* Flat themed panel, used both for the compact card and the wide
     (in-call) container. */
  .panel {
    position: relative;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    min-width: 0;
    height: auto;
    box-sizing: border-box;
    background-color: var(--theme-comp-header-color);
    border: 1px solid var(--theme-button-border);
    border-radius: 1rem;
    box-shadow:
      var(--theme-popup-shadow),
      0 12px 32px rgba(0, 0, 0, 0.12);
  }

  /* Content wrapper inside the panel */
  .panel .form-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
  }

  /* Mobile: disable the fixed full-screen overlay for the in-call (wide)
     layout, falling back to a normal in-flow block. The compact card
     (.login-column) is already fluid and needs no override. */
  @media (max-width: 768px) {
    .wide {
      position: static !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      bottom: auto !important;
    }
  }
</style>
