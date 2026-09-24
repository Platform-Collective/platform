<!--
// Copyright © 2026 Intabia Fusion.
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
  import { PendingRecording } from '@hcengineering/love'
  import { WithLookup } from '@hcengineering/core'
  import { ObjectPresenterType } from '@hcengineering/view'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { tooltip, Icon, Label, humanReadableFileSize } from '@hcengineering/ui'
  import love from '../plugin'

  export let value: WithLookup<PendingRecording>
  export let inline: boolean = false
  export let disabled: boolean = false
  export let accent: boolean = false
  export let noUnderline: boolean = false
  export let shouldShowAvatar = true
  export let type: ObjectPresenterType = 'link'

  $: formatLabel = value.format === 'video' ? 'MP4' : 'Audio'
  $: sizeDisplay = value.size != null && value.size > 0 ? humanReadableFileSize(value.size) : undefined
</script>

{#if value}
  {#if inline}
    <span class="inline-presenter" use:tooltip={{ label: getEmbeddedLabel(value.name) }}>
      <Icon icon={love.icon.Record} size={'x-small'} />
      <span class="label">{value.name}</span>
    </span>
  {:else if type === 'link'}
    <div class="flex-row-center pending-recording-container" use:tooltip={{ label: getEmbeddedLabel(value.name) }}>
      {#if shouldShowAvatar}
        <div class="icon recording-icon">
          <Icon icon={love.icon.Record} size={'medium'} />
        </div>
      {/if}
      <div class="flex-col info-container">
        <div class="name" class:no-underline={noUnderline || disabled} class:fs-bold={accent}>
          {value.name}
        </div>
        <div class="info-content flex-row-center">
          <span class="format-badge">{formatLabel}</span>
          {#if sizeDisplay}
            <span class="separator">•</span>
            <span class="size">{sizeDisplay}</span>
          {/if}
          <span class="separator">•</span>
          <span class="recording-indicator">
            <span class="recording-dot"></span>
            <Label label={love.string.Recording} />
          </span>
        </div>
      </div>
    </div>
  {:else if type === 'text'}
    <span class="overflow-label" use:tooltip={{ label: getEmbeddedLabel(value.name) }}>
      {value.name}
    </span>
  {/if}
{/if}

<style lang="scss">
  .inline-presenter {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;

    .label {
      white-space: nowrap;
    }
  }

  .pending-recording-container {
    flex-shrink: 0;
    width: auto;
    height: 3rem;
    min-width: 14rem;
    border-radius: 0.25rem;
    gap: 0;

    .recording-icon {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 3rem;
      height: 3rem;
      border: 1px solid var(--theme-button-border);
      border-radius: 0.25rem 0 0 0.25rem;
      background-color: var(--theme-warning-color);
      color: var(--theme-caption-color);
    }

    .info-container {
      padding: 0.5rem 0.75rem;
      width: 100%;
      height: 100%;
      background-color: var(--theme-button-default);
      border: 1px solid var(--theme-button-border);
      border-left: none;
      border-radius: 0 0.25rem 0.25rem 0;
      justify-content: center;
    }

    .name {
      white-space: nowrap;
      font-size: 0.8125rem;
      color: var(--theme-caption-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .info-content {
      white-space: nowrap;
      font-size: 0.6875rem;
      color: var(--theme-darker-color);
      gap: 0.25rem;
    }

    .format-badge {
      padding: 0.0625rem 0.25rem;
      background-color: var(--theme-button-pressed);
      border-radius: 0.125rem;
      font-size: 0.625rem;
      font-weight: 500;
    }

    .separator {
      color: var(--theme-dark-color);
    }

    .size {
      color: var(--theme-darker-color);
    }

    .recording-indicator {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      color: var(--theme-error-color);
    }

    .recording-dot {
      display: inline-block;
      width: 0.375rem;
      height: 0.375rem;
      background-color: var(--theme-error-color);
      border-radius: 50%;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }

    &:hover .info-container {
      background-color: var(--theme-button-hovered);
    }
  }
</style>
