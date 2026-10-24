<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import core, { type PersonId } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import contact, { getPersonByPersonIdCb, type Person } from '@hcengineering/contact'
  import { type IconSize, Label } from '@hcengineering/ui'

  import ObjectPresenter from './ObjectPresenter.svelte'
  import { getPersonIdPresenterState } from './person-id-presenter'

  export let value: PersonId | undefined
  export let shouldShowName = true
  export let shouldShowAvatar = true
  export let noUnderline = false
  export let shrink: boolean = false
  export let avatarSize: IconSize = 'x-small'
  export let withPadding: boolean = true

  const client = getClient()
  let person: Readonly<Person> | null | undefined
  $: loadPerson(value)
  $: state = getPersonIdPresenterState(value, person, core.account.System)

  function loadPerson(personId: PersonId | undefined): void {
    person = undefined
    if (personId == null || personId === '' || personId === core.account.System) return

    // Resolves synchronously from the contact cache, so cached authors render without a loading state.
    getPersonByPersonIdCb(client, personId, (resolvedPerson) => {
      if (value === personId) person = resolvedPerson
    })
  }
</script>

{#if state !== 'empty'}
  <div class={withPadding ? 'pl-3' : ''}>
    {#if state === 'system'}
      <Label label={core.string.System} />
    {:else if state === 'loading'}
      <!-- Keep the cell empty while the author is resolved, as before. -->
    {:else if state === 'resolved' && person != null}
      <ObjectPresenter
        objectId={person._id}
        _class={contact.class.Person}
        {shouldShowName}
        {shouldShowAvatar}
        {noUnderline}
        shrink={shrink ? 1 : 0}
        props={{ avatarSize }}
      />
    {:else}
      <span class="overflow-label">{value}</span>
    {/if}
  </div>
{/if}
