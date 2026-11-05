<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { AccountRole } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { HeaderButton, type HeaderButtonAction } from '@hcengineering/ui'

  import branding from '../plugin'
  import { chooseTypeAndCreate } from '../templates'

  export let currentSpecial: string | undefined = undefined

  const client = getClient()
  let button: HTMLDivElement

  const actions: HeaderButtonAction[] = [
    {
      id: 'new-template',
      label: branding.string.CreateTemplate,
      icon: branding.icon.Template,
      accountRole: AccountRole.Maintainer,
      callback: () => {
        // Sections named after a preset type create a template of that type directly
        const preset = currentSpecial?.startsWith('type-') === true ? currentSpecial.slice(5) : undefined
        chooseTypeAndCreate(button, preset)
      }
    }
  ]
</script>

<div bind:this={button}>
  <HeaderButton loading={false} {client} mainActionId={'new-template'} {actions} />
</div>
