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
  import { Ref } from '@hcengineering/core'
  import { Component } from '@hcengineering/ui'
  import { getClient } from '@hcengineering/presentation'
  import contact, { Person } from '@hcengineering/contact'
  import { Analytics } from '@hcengineering/analytics'
  import type { Filter } from '@hcengineering/view'
  import { createFilterPersonUpdater } from './person-filter'
  import type { PersonFilterValue } from './person-filter'

  export let value: PersonFilterValue[]
  export let filter: Filter

  const client = getClient()
  let persons: Ref<Person>[] = []
  const updatePersons = createFilterPersonUpdater(client, (value) => {
    persons = value
  })
  $: void updatePersons(value ?? [], filter.key.attribute.type).catch((err: unknown) => {
    Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
  })
</script>

<Component is={contact.component.PersonFilterValuePresenter} props={{ value: persons }} />
