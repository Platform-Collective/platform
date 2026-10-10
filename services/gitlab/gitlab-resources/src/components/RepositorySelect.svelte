<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import {
    Button,
    type ButtonKind,
    type ButtonSize,
    eventToHTMLElement,
    SelectPopup,
    type SelectPopupValueType,
    showPopup
  } from '@hcengineering/ui'
  import gitlab from '../plugin'

  export let repositories: GitlabIntegrationRepository[]
  // The shown repository; null shows "Without repository"
  export let value: GitlabIntegrationRepository | null
  // Overrides the shown value, e.g. "Create in GitLab"
  export let label: IntlString | undefined = undefined
  export let allowNone = true
  export let kind: ButtonKind = 'regular'
  export let size: ButtonSize = 'small'
  export let disabled = false
  export let onChange: (repository: Ref<GitlabIntegrationRepository> | null) => void

  // SelectPopup ids are strings; this one stands for "Without repository"
  const NONE = '#none'

  function open(event: MouseEvent): void {
    const items: SelectPopupValueType[] = repositories.map((it) => ({
      id: it._id,
      icon: gitlab.icon.GitlabRepository,
      label: getEmbeddedLabel(it.pathWithNamespace)
    }))
    if (allowNone) items.push({ id: NONE, label: gitlab.string.WithoutRepository })
    showPopup(SelectPopup, { value: items, searchable: items.length > 5 }, eventToHTMLElement(event), (result) => {
      if (result === undefined || result === null) return
      onChange(result === NONE ? null : (result as Ref<GitlabIntegrationRepository>))
    })
  }

  $: shown = label ?? (value === null ? gitlab.string.WithoutRepository : getEmbeddedLabel(value.pathWithNamespace))
</script>

<Button {kind} {size} {disabled} icon={gitlab.icon.Gitlab} label={shown} on:click={open} />
