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
  import { MeetingMinutes, TranscriptionState } from '@hcengineering/love'
  import { StateType, StateTag } from '@hcengineering/ui'

  import love from '../plugin'

  export let object: MeetingMinutes | undefined
  export let value: TranscriptionState | undefined
  export let attributeKey: string | undefined

  const displayData = {
    [TranscriptionState.NotStarted]: {
      label: love.string.TranscriptionNotStarted,
      type: StateType.Ghost
    },
    [TranscriptionState.Transcribing]: {
      label: love.string.TranscriptionTranscribing,
      type: StateType.Positive
    },
    [TranscriptionState.Finished]: {
      label: love.string.TranscriptionFinished,
      type: StateType.Regular
    }
  }

  let state: TranscriptionState | undefined

  $: state = value ?? object?.transcriptionState
  $: data = state !== undefined ? displayData[state] : undefined
</script>

{#if data}
  <span class="flex-row-center">
    <StateTag type={data.type} label={data.label} />
  </span>
{/if}
