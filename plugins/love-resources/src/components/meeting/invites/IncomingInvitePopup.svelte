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
  import { Person, formatName } from '@hcengineering/contact'
  import { Avatar, getPersonByPersonRefCb } from '@hcengineering/contact-resources'
  import { Label, ModernButton } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import love from '../../../plugin'
  import { responseToInviteRequest } from '../../../invites'
  import { type UserMeetingInvite } from '@hcengineering/love'

  export let invite: UserMeetingInvite

  const dispatch = createEventDispatcher()

  let person: Person | undefined = undefined
  let timeLeft: number = 30
  let interval: ReturnType<typeof setInterval>

  // Reactive update when invite.expiresAt changes
  $: {
    timeLeft = Math.max(0, Math.floor((invite.expiresAt - Date.now()) / 1000))
  }

  onMount(async () => {
    // Load person details (sender)
    getPersonByPersonRefCb(invite.from, (p) => {
      person = p ?? undefined
    })

    // Start countdown
    interval = setInterval(() => {
      timeLeft = Math.max(0, Math.floor((invite.expiresAt - Date.now()) / 1000))
      if (timeLeft <= 0) {
        clearInterval(interval)
        void handleReject()
      }
    }, 1000)
  })

  onDestroy(() => {
    clearInterval(interval)
  })

  async function handleJoin (): Promise<void> {
    await responseToInviteRequest(invite, true)
    dispatch('close')
  }

  async function handleReject (): Promise<void> {
    await responseToInviteRequest(invite, false)
    dispatch('close')
  }
</script>

<div class="antiPopup invite-popup flex-gap-4">
  <div class="popup-header">
    {#if person}
      <div class="inviter-info">
        <Avatar {person} size={'small'} name={person.name} />
        <span class="inviter-name">{formatName(person.name)}</span>
      </div>
    {:else}
      <Label label={love.string.JoinMeeting} />
    {/if}
    {#if timeLeft <= 10}
      <span class="timer urgent">{timeLeft}s</span>
    {/if}
  </div>

  <div class="popup-message">
    {#if invite.meeting}
      <Label label={love.string.JoinMeeting} params={{ name: person?.name ?? '' }} />
    {:else}
      <Label label={love.string.InvitingYou} params={{ name: person?.name ?? '' }} />
    {/if}
  </div>

  <div class="popup-actions">
    <ModernButton label={love.string.Join} kind={'primary'} size={'medium'} on:click={handleJoin} />
    <ModernButton label={love.string.Reject} kind={'secondary'} size={'medium'} on:click={handleReject} />
  </div>
</div>

<style lang="scss">
  .invite-popup {
    padding: var(--spacing-2);
    min-width: 18rem;
    max-width: 25rem;

    .popup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .inviter-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-1);

        .inviter-name {
          font-weight: 600;
          font-size: 1rem;
          color: var(--theme-caption-color);
        }
      }

      .timer {
        font-size: 0.875rem;
        color: var(--theme-content-color);
        font-variant-numeric: tabular-nums;

        &.urgent {
          color: var(--theme-error-color);
          font-weight: 600;
        }
      }
    }

    .popup-message {
      text-align: center;
      font-size: 0.875rem;
      color: var(--theme-content-color);
      padding: var(--spacing-1) 0;
    }

    .popup-actions {
      display: flex;
      justify-content: center;
      gap: var(--spacing-1);
      padding-top: var(--spacing-1);
    }
  }
</style>
