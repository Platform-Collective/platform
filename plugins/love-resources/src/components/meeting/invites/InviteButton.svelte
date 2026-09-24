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
  import { Person } from '@hcengineering/contact'
  import { Avatar } from '@hcengineering/contact-resources'
  import { ModernButton, TimeLeft, ticker1 } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { UserMeetingInvite } from '@hcengineering/love'
  import love from '../../../plugin'
  import { getClient } from '@hcengineering/presentation'

  export let person: Person
  export let invite: UserMeetingInvite
  export let type: 'outgoing' | 'incoming'
  export let onClick: (e: MouseEvent, invite: UserMeetingInvite, person: Person) => void

  $: label = type === 'incoming' ? love.string.YouInvite : love.string.KnockingLabel

  $: tooltipLabel =
    type === 'outgoing' ? getEmbeddedLabel(`Inviting ${person.name}`) : getEmbeddedLabel(`Invited by ${person.name}`)

  $: if (invite.expiresAt < $ticker1) {
    void getClient().remove(invite)
  }
</script>

<ModernButton
  {label}
  kind="primary"
  size="small"
  tooltip={{ label: tooltipLabel, direction: 'bottom' }}
  on:click={(e) => {
    onClick(e, invite, person)
  }}
>
  <div class="avatars-container">
    <div class="combined-avatar tiny">
      <Avatar name={person.name} size={'card'} {person} />
    </div>
    <div class="p-1 time">
      <TimeLeft time={invite.expiresAt} />
    </div>
  </div>
</ModernButton>

<style lang="scss">
  .avatars-container {
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    margin-left: 0.5rem;
  }

  .time {
    /* background: rgba(0, 0, 0, 0.5); */
    color: var(--accent-color-base);
  }

  .combined-avatar {
    position: relative;
    margin-left: -0.5rem;

    &:first-child {
      margin-left: 0;
    }

    &.tiny {
      width: 1.5rem;
      height: 1.5rem;
    }

    &[data-over]::after {
      content: attr(data-over);
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      color: white;
      font-size: 0.625rem;
      font-weight: 600;
      border-radius: 50%;
    }
  }
</style>
