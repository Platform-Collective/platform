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
  import { Popup, Scroller, deviceOptionsStore as deviceInfo, themeStore } from '@hcengineering/ui'
  import workbench from '@hcengineering/workbench'
  import { onMount } from 'svelte'
  import login from '../plugin'

  // Resolve static asset URLs at runtime to avoid requiring image module declarations
  // (prevents TypeScript / diagnostics errors when module types are missing)
  import loginBack from '../../img/login_back.png'
  import loginBack2x from '../../img/login_back_2x.png'
  import loginBackAvif from '../../img/login_back.avif'
  import loginBack2xAvif from '../../img/login_back_2x.avif'
  import loginBackWebp from '../../img/login_back.webp'
  import loginBack2xWebp from '../../img/login_back_2x.webp'

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
  function onDevThemeChange (e: Event): void {
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
  <div class="bg-image clear-mins p-4 back">
    {#if activeTheme.backgroundComponent}
      <div class="back-image" style:display={'block'}>
        <svelte:component this={activeTheme.backgroundComponent} />
      </div>
    {:else}
      <picture>
        <source srcset={`${loginBackAvif}, ${loginBack2xAvif} 2x`} type="image/avif" />
        <source srcset={`${loginBackWebp}, ${loginBack2xWebp} 2x`} type="image/webp" />

        <img
          class="back-image"
          src={loginBack}
          style:display={'block'}
          srcset={`${loginBack} 1x, ${loginBack2x} 2x`}
          alt=""
        />
      </picture>
    {/if}

    <div
      style:position="fixed"
      style:left={$deviceInfo.docWidth <= 480 ? '.75rem' : '1.75rem'}
      style:top={'3rem'}
      style:z-index={10001}
      class="flex-row-center"
    >
      <svelte:component this={activeTheme.logoComponent} />
      {#if activeTheme.showTitle}
        <span class="fs-title ml-2">{getMetadata(workbench.metadata.PlatformTitle)}</span>
      {/if}
    </div>

    {#if getMetadata(platform.metadata.DevModel)}
      <div style:position="fixed" style:left={'0px'} style:top={'0px'} style:z-index={10000} class="flex-row-center">
        <select class="select small" value={$loginTheme.name} on:change={onDevThemeChange}>
          <option value="huly">Huly</option>
        </select>
      </div>
    {/if}

    <div class:panel-base={!wide} class="panel" class:wide>
      <Scroller padding={'1rem 0'}>
        <div class="form-content">
          <slot name="form-content" />
        </div>
        <slot name="extra-form-content" />
      </Scroller>
    </div>

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

  .back-image {
    position: fixed;
    top: 32px;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: left top;
    /* Ensure the background stays behind content and doesn't capture pointer events */
    z-index: -2;
    pointer-events: none;
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
  }

  .fs-title {
    color: var(--login-content-color, var(--theme-content-color));
  }

  /* Centralized layout: panel sizing/positioning is identical across themes.
     Themes control visuals only (colors, gradients, images). */
  .panel-base {
    position: fixed !important;
    z-index: 1000 !important;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 24% !important;
    width: 460px !important;
    height: auto;
    left: 50% !important;
    top: 50% !important;
    transform: translate(-50%, -50%) !important;
  }

  .panel {
    position: relative;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: auto;
    background: var(--login-panel-bg, rgba(45, 50, 160, 0.5));
    mix-blend-mode: normal;
    box-shadow: -30px 1.52px 173.87px #121437;
    backdrop-filter: blur(157.855px);
    border-radius: 1rem;
  }

  .panel::after {
    overflow: hidden;
    position: absolute;
    content: '';
    inset: 0;
    background: var(--login-panel-gradient);
    border-radius: 1rem;
    z-index: -1;
  }

  .panel::before {
    position: absolute;
    content: '';
    inset: 0;
    padding: 1px;
    background: conic-gradient(
        rgba(255, 255, 255, 0.18) 10%,
        rgba(126, 120, 165, 0.5),
        rgba(191, 216, 253, 0.5),
        rgba(246, 247, 249, 0.32),
        rgba(219, 229, 242, 0.34) 60%,
        rgba(163, 203, 255, 0.24) 90%
      )
      border-box;
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    border-radius: 1rem;
    transform: rotate(180deg);
    transition: opacity 0.15s var(--timing-main);
    opacity: 0.7;
    pointer-events: none;
  }

  @supports not (mask-composite: exclude) {
    .panel::before {
      z-index: -1;
    }
  }
  @supports not (-webkit-mask-composite: xor) {
    .panel::before {
      z-index: -1;
    }
  }

  /* Content wrapper inside the panel */
  .panel .form-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    /* flex-grow: 1; */
    height: 100%;
  }

  /* Intabia-scoped primary button visuals */
  .login-theme-intabia .antiButton.primary {
    border-radius: var(--primary-button-border-radius, 0.5rem);
    padding: var(--primary-button-padding, 0 1.5rem);
    height: var(--primary-button-height, 3.5rem);
    font-size: var(--primary-button-font-size, 1rem);
    font-weight: var(--primary-button-font-weight, 600);
    background-color: var(--login-primary-button-default);
    color: var(--login-button-text-color, #ffffff);
  }
  .login-theme-intabia .antiButton.primary:hover {
    background-color: var(--login-primary-button-hovered);
  }
  .login-theme-intabia .antiButton.primary:active {
    background-color: var(--login-primary-button-pressed);
  }
  .login-theme-intabia .antiButton.primary:focus-visible {
    outline: 0;
    box-shadow: 0 0 0 4px var(--login-primary-button-focus-ring);
    border-color: var(--login-primary-button-focused);
  }
  .login-theme-intabia .antiButton.primary[disabled],
  .login-theme-intabia .antiButton.primary:disabled {
    background: var(--login-button-contrast-disabled);
    color: var(--login-button-contrast-disabled-color);
    cursor: not-allowed;
    opacity: 1;
    box-shadow: none;
    border-color: var(--login-button-contrast-border);
  }
  /* Localized popup label color for login theme (applies only inside login UI) */
  .login-theme-intabia .login-popup .hulyPopup-row__label {
    color: var(--login-content-color, var(--theme-content-color));
  }

  /* Huly-scoped primary button visuals (contrast) */
  .login-theme-huly .antiButton.primary {
    border-radius: var(--primary-button-border-radius, 0.5rem);
    padding: var(--primary-button-padding, 0 1.5rem);
    height: var(--primary-button-height, 3.5rem);
    font-size: var(--primary-button-font-size, 1rem);
    font-weight: var(--primary-button-font-weight, 600);
    background-color: var(--login-button-contrast-enabled, rgb(255, 255, 255));
    color: var(--login-button-contrast-color, rgb(0, 0, 0));
    border-color: var(--login-button-contrast-border, rgba(255, 255, 255, 0.2));
  }
  .login-theme-huly .antiButton.primary:hover {
    background-color: var(--login-button-contrast-hovered, #ffffff);
  }
  .login-theme-huly .antiButton.primary:active {
    background-color: var(--login-button-contrast-pressed, rgba(255, 255, 255, 0.6));
  }
  .login-theme-huly .antiButton.primary:focus-visible {
    outline: 0;
    box-shadow: 0 0 0 4px var(--login-primary-button-focus-ring);
    border-color: var(--login-primary-button-focused);
  }
  .login-theme-huly .antiButton.primary[disabled],
  .login-theme-huly .antiButton.primary:disabled {
    background: var(--login-button-contrast-disabled);
    color: var(--login-button-contrast-disabled-color);
    cursor: not-allowed;
    opacity: 1;
    box-shadow: none;
    border-color: var(--login-button-contrast-border);
  }
  /* Localized popup label color for Huly login theme (applies only inside login UI) */
  .login-theme-huly .login-popup .hulyPopup-row__label {
    color: var(--login-content-color, var(--theme-content-color));
  }

  /* Mobile fallbacks: make panel full-width and ensure panel-base padding/background
     so the login container looks correct on smaller screens and is controlled centrally. */
  @media (max-width: 768px) {
    /* Keep a small margin from the screen edges on narrow devices */
    .panel,
    .panel-base {
      position: static !important;
      left: auto !important;
      top: auto !important;
      transform: none !important;
      width: calc(100% - 2rem) !important;
      min-width: 0 !important;
      max-width: calc(100% - 2rem) !important;
      margin-left: 1rem !important;
      margin-right: 1rem !important;
    }

    .backd.paneld .panel-base,
    .backd .paneld .panel-base {
      width: calc(100% - 2rem) !important;
      margin-left: 1rem !important;
      margin-right: 1rem !important;
    }
  }
</style>
