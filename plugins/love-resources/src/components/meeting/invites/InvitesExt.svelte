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
  import { closePopup, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'

  import { outgoingInvitesStore, incomingInvitesStore, closeInvitesPopup } from '../../../invites'
  import InviteButton from './InviteButton.svelte'
  import OutgoingInvitePopup from '../invites/OutgoingInvitePopup.svelte'
  import IncomingInvitePopup from '../invites/IncomingInvitePopup.svelte'
  import { getPersonsByPersonRefsCb } from '@hcengineering/contact-resources'
  import { Person } from '@hcengineering/contact'
  import { Ref } from '@hcengineering/core'
  import { UserMeetingInvite } from '@hcengineering/love'

  const invitesCategory = 'meetingInvites'

  $: outgoingInvites = $outgoingInvitesStore

  $: incomingInvites = $incomingInvitesStore

  let outgoingWithPersons = new Map<Ref<Person>, Readonly<Person>>()
  let incomingWithPersons = new Map<Ref<Person>, Readonly<Person>>()

  $: getPersonsByPersonRefsCb(
    outgoingInvites.map((it) => it.to),
    (persons) => {
      outgoingWithPersons = persons
    }
  )

  $: getPersonsByPersonRefsCb(
    incomingInvites.map((it) => it.from),
    (persons) => {
      incomingWithPersons = persons
    }
  )

  function openOutgoingInvites (e: MouseEvent, invite: UserMeetingInvite, person: Person): void {
    closePopup(invitesCategory)
    showPopup(
      OutgoingInvitePopup,
      { person, invite },
      eventToHTMLElement(e),
      () => {
        // onClose - clear outgoing invites when popup closed
        closeInvitesPopup()
      },
      undefined,
      {
        category: invitesCategory,
        overlay: true
      }
    )
  }

  function openIncomingInvites (e: MouseEvent, invite: UserMeetingInvite, person: Person): void {
    closePopup(invitesCategory)
    showPopup(
      IncomingInvitePopup,
      { invite, person },
      eventToHTMLElement(e),
      () => {
        // onClose - handled by panel itself
      },
      undefined,
      {
        category: invitesCategory,
        overlay: true
      }
    )
  }

  onDestroy(() => {
    closePopup(invitesCategory)
  })
</script>

<div class="flex-row-center flex-gap-2">
  {#if outgoingInvites.length > 0}
    {#each outgoingInvites as invite}
      {@const person = outgoingWithPersons.get(invite.to)}
      {#if person !== undefined}
        <InviteButton {invite} {person} type="outgoing" onClick={openOutgoingInvites} />
      {/if}
    {/each}
  {/if}

  {#if incomingInvites.length > 0}
    {#each incomingInvites as invite}
      {@const person = incomingWithPersons.get(invite.from)}
      {#if person !== undefined}
        <InviteButton {invite} {person} type="incoming" onClick={openIncomingInvites} />
      {/if}
    {/each}
  {/if}
</div>

<style lang="scss">
  .flex-row-center {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .flex-gap-2 {
    gap: 0.5rem;
  }
</style>
