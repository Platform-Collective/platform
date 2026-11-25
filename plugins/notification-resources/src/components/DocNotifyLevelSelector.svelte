<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { type DocNotifyContext, type DocNotifyLevel } from '@hcengineering/notification'
  import { SelectPopup, type SelectPopupValueType } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { getDocNotifyLevelValues } from '../notifyLevelOptions'
  import { updateDocNotifyLevel } from '../utils'

  export let value: DocNotifyContext

  const dispatch = createEventDispatcher<{ close: undefined }>()
  let loading = false

  function select(result: SelectPopupValueType['id']): void {
    if (typeof result !== 'string') {
      dispatch('close')
      return
    }

    loading = true
    void updateDocNotifyLevel(value, result as DocNotifyLevel)
      .then(() => {
        dispatch('close')
      })
      .catch((error) => {
        Analytics.handleError(error)
      })
      .finally(() => {
        loading = false
      })
  }
</script>

<SelectPopup
  value={getDocNotifyLevelValues(value)}
  {loading}
  onSelect={select}
  on:close={() => dispatch('close')}
  on:changeContent
/>
