<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import { type Issue } from '@hcengineering/tracker'
  import { Icon } from '@hcengineering/ui'
  import gitlab from '../../plugin'
  import { gitlabRepositories } from '../repositories'

  export let value: Issue

  $: link = getClient().getHierarchy().asIf(value, gitlab.mixin.GitlabIssue)
  $: repository = link?.repository != null ? $gitlabRepositories.get(link.repository) : undefined
</script>

{#if link !== undefined && link.gitlabIid > 0}
  <a class="flex-row-center" href={link.url} target="_blank" rel="noreferrer">
    <Icon icon={gitlab.icon.Gitlab} size={'small'} />
    <span class="ml-1">{repository?.pathWithNamespace ?? ''} #{link.gitlabIid}</span>
  </a>
{/if}
