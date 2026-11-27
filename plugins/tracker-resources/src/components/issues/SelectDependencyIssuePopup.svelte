<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Issue, IssueRelation } from '@hcengineering/tracker'
  import SelectIssuePopup from './SelectIssuePopup.svelte'

  export let issue: Issue
  export let outgoing: IssueRelation[] = []
  export let extraIgnore: Ref<Issue>[] = []

  $: docQuery = { space: issue.space }
  $: ignoreObjects = [issue._id, ...outgoing.map((r) => r.target), ...extraIgnore] as Ref<Issue>[]
</script>

<SelectIssuePopup {docQuery} {ignoreObjects} on:update on:close />
