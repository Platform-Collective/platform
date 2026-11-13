<!--
//
// Copyright © 2025 Hardcore Engineering Inc.
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
//
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { Card, CardEvents } from '@hcengineering/card'
  import { Ref } from '@hcengineering/core'
  import { getCurrentLocation, navigate } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'

  import { cardPanelHistory } from '../card-panel-history'
  import EditCardNew from './EditCardNew.svelte'

  export let _id: Ref<Card>
  export let readonly: boolean = false
  export let embedded: boolean = false
  export let allowClose: boolean = true

  const dispatch = createEventDispatcher()

  export function canClose(): boolean {
    return false
  }

  /** Escape returns to the previously opened card; the close button closes the whole chain. */
  export function handlePanelBack(): boolean {
    const previousFragment = cardPanelHistory.back()
    if (previousFragment === undefined) return false

    const loc = getCurrentLocation()
    loc.fragment = previousFragment
    navigate(loc)
    return true
  }

  onMount(() => {
    Analytics.handleEvent(CardEvents.CardOpened, { id: _id })
  })
</script>

<EditCardNew
  {_id}
  {readonly}
  {embedded}
  {allowClose}
  on:close={() => {
    cardPanelHistory.update(undefined)
    dispatch('close')
  }}
  on:open
/>
