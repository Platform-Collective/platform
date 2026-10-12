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
  import { Person } from '@hcengineering/contact'
  import { Avatar, getPersonByPersonRef, PersonPresenter } from '@hcengineering/contact-resources'
  import { ParticipantInfo } from '@hcengineering/love'

  import { Ref } from '@hcengineering/core'

  export let info: ParticipantInfo[]

  async function getPerson(info: Ref<Person> | undefined): Promise<Person | undefined> {
    if (info === undefined) {
      return
    }

    return (await getPersonByPersonRef(info)) ?? undefined
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-mouse-events-have-key-events -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
{#each info as personInfo}
  {#await getPerson(personInfo.person) then person}
    <!-- <Avatar
            name={person?.name ?? personInfo.name}
            {person}
            size={'large'}
            showStatus={false}
            clickable
            style="modern"
            /> -->
    {#if person != null}
      <PersonPresenter value={person} avatarSize={'large'} shouldShowName={false} />
    {/if}
  {/await}
{/each}
