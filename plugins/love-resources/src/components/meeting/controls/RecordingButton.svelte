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
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { ButtonBaseSize, ModernButton } from '@hcengineering/ui'
  import { isRecording, isRecordingAvailable, loveClient } from '../../../utils'
  import love from '../../../plugin'
  import { lkSessionConnected } from '../../../liveKitClient'
  import { currentMeetingMinutes, currentVideoRecording, isCancellingVideoRecording } from '../../../stores'

  export let size: ButtonBaseSize = 'large'
  export let kind: 'primary' | 'secondary' | 'tertiary' | 'negative' = 'secondary'

  $: isVideoRecording = $isRecording && $currentVideoRecording !== undefined
  $: isStopping = $isCancellingVideoRecording
</script>

{#if hasAccountRole(getCurrentAccount(), AccountRole.User) && $isRecordingAvailable && $currentMeetingMinutes !== undefined}
  <ModernButton
    icon={isVideoRecording ? love.icon.StopRecord : love.icon.Record}
    tooltip={{
      label: isStopping ? love.string.StoppingRecord : isVideoRecording ? love.string.StopRecord : love.string.Record
    }}
    disabled={!$lkSessionConnected || isStopping}
    loading={isStopping}
    {kind}
    {size}
    on:click={() => {
      if ($currentMeetingMinutes !== undefined && !isStopping) {
        void loveClient.record($currentMeetingMinutes)
      }
    }}
  />
{/if}
