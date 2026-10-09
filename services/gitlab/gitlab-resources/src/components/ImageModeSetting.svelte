<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { type GitlabImageMode, type GitlabIntegration, imageModeOf } from '@hcengineering/gitlab'
  import { getClient } from '@hcengineering/presentation'
  import { DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import { errorText } from '../errors'
  import { IMAGE_MODES, imageModeHint, imageModeLabel } from '../image-mode'
  import gitlab from '../plugin'

  export let integration: GitlabIntegration

  const client = getClient()
  // Integration setup is for workspace owners, as in SetupApp
  const isOwner = hasAccountRole(getCurrentAccount(), AccountRole.Owner)
  const items = IMAGE_MODES.map((id) => ({ id, label: imageModeLabel(id) }))
  let error: string | undefined

  $: mode = imageModeOf(integration)

  async function choose (selected: GitlabImageMode): Promise<void> {
    if (selected === mode) return
    error = undefined
    try {
      await client.update(integration, { imageMode: selected })
    } catch (err) {
      error = errorText(err)
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    }
  }
</script>

<div class="flex-col flex-gap-1">
  <div class="flex-row-center flex-gap-2">
    <Label label={gitlab.string.ImageMode} />
    <DropdownLabelsIntl
      {items}
      selected={mode}
      disabled={!isOwner}
      on:selected={(ev) => choose(ev.detail)}
    />
  </div>
  <span class="dark-color"><Label label={imageModeHint(mode)} /></span>
  {#if error !== undefined}
    <span class="error-color">{error}</span>
  {/if}
</div>
