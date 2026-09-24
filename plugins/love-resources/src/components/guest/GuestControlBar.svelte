<!--
// Copyright © 2026 Intabia Fusion.
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
  import { ModernButton, Popup, TooltipInstance } from '@hcengineering/ui'

  import love from '../../plugin'
  import { myInfo, myOffice } from '../../stores'
  import { isFullScreen } from '../../utils'
  import ControlBarContainer from '../meeting/ControlBarContainer.svelte'
  import { lkSessionConnected } from '../../liveKitClient'
  import SendReactionButton from '../meeting/controls/SendReactionButton.svelte'
  import MicrophoneButton from '../meeting/controls/MicrophoneButton.svelte'
  import CameraButton from '../meeting/controls/CameraButton.svelte'
  import ShareScreenButton from '../meeting/controls/ShareScreenButton.svelte'

  export let canMaximize: boolean = true
  export let fullScreen: boolean = false
  export let onFullScreen: (() => void) | undefined = undefined
  export let leaveGuest: () => Promise<void>
</script>

<div class="control-bar" class:theme-light={!$isFullScreen} class:theme-dark={$isFullScreen}>
  <ControlBarContainer>
    <svelte:fragment slot="center">
      {#if $lkSessionConnected}
        <SendReactionButton />
        <MicrophoneButton checkActions={false} />
        <CameraButton checkActions={false} />
        <ShareScreenButton />
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="right">
      {#if $lkSessionConnected && onFullScreen}
        <ModernButton
          icon={$isFullScreen ? love.icon.ExitFullScreen : love.icon.FullScreen}
          tooltip={{
            label: $isFullScreen ? love.string.ExitingFullscreenMode : love.string.FullscreenMode,
            direction: 'top'
          }}
          kind={'secondary'}
          size={'large'}
          on:click={() => {
            $isFullScreen = !$isFullScreen
          }}
        />
      {/if}

      <ModernButton
        icon={love.icon.LeaveRoom}
        label={love.string.LeaveRoom}
        tooltip={{ label: love.string.LeaveRoom, direction: 'top' }}
        kind={'negative'}
        size={'medium'}
        on:click={leaveGuest}
      />
    </svelte:fragment>

    <svelte:fragment slot="extra">
      {#if fullScreen}
        <Popup fullScreen />
        <TooltipInstance fullScreen />
      {/if}
    </svelte:fragment>
  </ControlBarContainer>
</div>

<style lang="scss">
  .control-bar {
    width: 100%;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
