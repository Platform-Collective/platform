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
  import { Button, Notification, NotificationToast } from '@hcengineering/ui'
  import love from '../../plugin'
  import { onMount } from 'svelte'
  import { playSound } from '@hcengineering/presentation'

  export let onRemove: () => void
  export let notification: Notification

  function stayInMeeting(): void {
    onRemove()
  }

  async function leave(): Promise<void> {
    // Use dynamic import to avoid circular dependency
    const { leaveMeeting } = await import('../../meetings')
    await leaveMeeting()
    onRemove()
  }

  onMount(async () => {
    await playSound(love.sound.MeetingEndNotification)
  })
</script>

<NotificationToast title={notification.title} severity={notification.severity} onClose={onRemove}>
  <svelte:fragment slot="content">
    {notification.subTitle}
  </svelte:fragment>
  <svelte:fragment slot="buttons">
    <div style="width: auto" />
    <div class="flex-between gap-2">
      <Button label={love.string.LeaveRoom} stopPropagation={false} kind="negative" on:click={leave} />
      <Button label={love.string.StayInRoom} stopPropagation={false} kind="primary" on:click={stayInMeeting} />
    </div>
  </svelte:fragment>
</NotificationToast>
