<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import { type Issue } from '@hcengineering/tracker'
  import gitlab from '../../plugin'
  import GitlabRefLink from '../GitlabRefLink.svelte'
  import { gitlabRepositories } from '../repositories'

  export let value: Issue

  $: link = getClient().getHierarchy().asIf(value, gitlab.mixin.GitlabIssue)
  $: repository = link?.repository != null ? $gitlabRepositories.get(link.repository) : undefined
</script>

{#if link !== undefined && link.gitlabIid > 0}
  <GitlabRefLink
    icon={gitlab.icon.Gitlab}
    url={link.url}
    repository={repository?.pathWithNamespace ?? ''}
    reference={`#${link.gitlabIid}`}
  />
{/if}
