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
  import { Avatar } from '@hcengineering/contact-resources'
  import { Label, ModernButton, Scroller } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import love from '../../../plugin'
  import { cancelInvites, inviteRequestSecondsToLive } from '../../../invites'
  import { UserMeetingInvite } from '@hcengineering/love'

  export let person: Person
  export let invite: UserMeetingInvite

  const dispatch = createEventDispatcher()

  let timeLeft: number = inviteRequestSecondsToLive
  let countdownInterval: ReturnType<typeof setInterval>

  onMount(() => {
    // Start countdown
    countdownInterval = setInterval(() => {
      timeLeft--
      if (timeLeft <= 0) {
        clearInterval(countdownInterval)
      }
    }, 1000)
  })

  onDestroy(() => {
    clearInterval(countdownInterval)
  })

  async function handleCancel(): Promise<void> {
    await cancelInvites(undefined, [invite])
    dispatch('close')
  }
</script>

<div class="antiPopup invite-popup flex-gap-4">
  <div class="popup-header">
    <Label label={love.string.YouInvite} />
    {#if timeLeft <= 10}
      <span class="timer urgent">{timeLeft}s</span>
    {/if}
  </div>

  <div class="popup-content">
    <Scroller padding={'0.5rem'} stickedScrollBars>
      <div class="persons-grid">
        <div class="person-item">
          <Avatar {person} size={'medium'} name={person.name} />
          <span class="person-name">{formatName(person.name)}</span>
        </div>
      </div>
    </Scroller>
  </div>

  <div class="popup-actions">
    <ModernButton label={love.string.Cancel} kind={'secondary'} size={'medium'} on:click={handleCancel} />
  </div>
</div>

<style lang="scss">
  .invite-popup {
    padding: var(--spacing-2);
    min-width: 20rem;
    max-width: 30rem;
    max-height: 25rem;

    .popup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 1rem;
      color: var(--theme-caption-color);

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

    .popup-content {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      border: 1px solid var(--theme-popup-divider);
      border-radius: var(--medium-BorderRadius);
      max-height: 15rem;

      .persons-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--spacing-1);
        padding: var(--spacing-1);

        .person-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-1);
          padding: var(--spacing-0_5);

          .person-name {
            font-size: 0.875rem;
            color: var(--theme-content-color);
          }
        }
      }
    }

    .popup-actions {
      display: flex;
      justify-content: center;
      padding-top: var(--spacing-1);
      gap: var(--spacing-1);

      .debug-btn {
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        background: var(--theme-button-default);
        border: 1px solid var(--theme-button-border);
        border-radius: var(--small-BorderRadius);
        cursor: pointer;

        &:hover {
          background: var(--theme-button-hovered);
        }
      }
    }
  }
</style>
