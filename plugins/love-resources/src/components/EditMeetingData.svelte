<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { Event } from '@hcengineering/calendar'
  import love from '../plugin'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { ObjectPresenter } from '@hcengineering/view-resources'
  import { MeetingMinutes, MeetingStatus } from '@hcengineering/love'
  import { Button, Icon, IconRedo, Label } from '@hcengineering/ui'
  import MeetingMinutesStatusPresenter from './MeetingMinutesStatusPresenter.svelte'

  export let value: Event
  export let readOnly: boolean = false

  const valueQuery = createQuery()
  const meetingQuery = createQuery()

  let _value: Event = value

  $: valueQuery.query(value._class, { _id: value._id }, (r) => {
    _value = r.shift() ?? value
  })
  const client = getClient()

  $: isMeeting = client.getHierarchy().hasMixin(_value, love.mixin.MeetingEventLink)
  $: meeting = isMeeting ? client.getHierarchy().as(_value, love.mixin.MeetingEventLink) : null

  let meetingDoc: MeetingMinutes | undefined

  $: meetingQuery.query(love.class.MeetingMinutes, { _id: meeting?.meetingId }, (r) => {
    meetingDoc = r.shift()
  })

  async function resetMeeting(meetingDoc: MeetingMinutes): Promise<void> {
    if (meetingDoc.status === MeetingStatus.Active || meetingDoc.status === MeetingStatus.Pending) {
      // Disallow change for active meeting
      return
    }
    await client.diffUpdate(meetingDoc, { status: MeetingStatus.Scheduled })
  }
</script>

{#if isMeeting && meetingDoc !== undefined}
  {@const doc = meetingDoc}
  <div class="flex-col mt-2">
    <div class="flex-row-center">
      <div class="mr-2">
        <Icon icon={love.icon.MeetingMinutes} size={'small'} />
      </div>
      <div class="mr-2">
        <Label label={love.string.Meeting} />
      </div>
      <div class="flex-grow">
        <ObjectPresenter
          shouldShowAvatar={false}
          objectId={meetingDoc._id}
          _class={meetingDoc._class}
          value={meetingDoc}
        />
      </div>
      <div class="ml-3 flex flex-row-center">
        <MeetingMinutesStatusPresenter object={meetingDoc} value={meetingDoc.status} attributeKey={'status'} />
        {#if meetingDoc?.status === MeetingStatus.Finished}
          <Button kind={'ghost'} icon={IconRedo} size={'x-small'} on:click={() => resetMeeting(doc)} />
        {/if}
      </div>
    </div>
  </div>
{/if}
