<!--
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
  import { Label } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import love from '../../plugin'
  import { speakingWhileMuted } from '../../stores'
  import { acquireSpeakingWhileMutedWatch } from '../../speakingWhileMuted'

  // Local analyser only — never published to LiveKit/server. Opt-out via preference.
  // The watch is shared across all mounted indicators (topbar + fullscreen).
  let release: (() => void) | undefined
  onMount(() => {
    release = acquireSpeakingWhileMutedWatch()
  })
  onDestroy(() => {
    release?.()
  })
</script>

{#if $speakingWhileMuted}
  <div class="speaking-muted flex-row-center flex-gap-1">
    <span class="dot" />
    <Label label={love.string.SpeakingWhileMuted} />
  </div>
{/if}

<style lang="scss">
  .speaking-muted {
    height: 1.75rem;
    padding: 0 0.5rem;
    background-color: var(--bg-negative-default, #d64340);
    color: #fff;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    white-space: nowrap;
    animation: speaking-muted-blink 1s ease-in-out infinite;

    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: #fff;
    }
  }

  @keyframes speaking-muted-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }
</style>
