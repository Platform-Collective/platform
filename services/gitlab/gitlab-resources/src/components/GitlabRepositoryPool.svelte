<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Space } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { type Writable } from 'svelte/store'
  import gitlab from '../plugin'
  import { linkedRepositories, type RepositoryChoice, shownRepository, validChoice } from '../repository-choice'
  import { gitlabRepositories } from './repositories'
  import RepositorySelect from './RepositorySelect.svelte'

  export let state: Writable<RepositoryChoice>
  export let space: Space | undefined

  function correct(valid: RepositoryChoice): void {
    if (valid !== $state) $state = valid
  }

  $: isGitlab = space !== undefined && getClient().getHierarchy().hasMixin(space, gitlab.mixin.GitlabProject)
  $: linked = isGitlab ? linkedRepositories($gitlabRepositories.values(), space?._id) : []
  // A pick from a project the user switched away from does not apply here
  $: correct(validChoice($state, linked))
  $: shown = shownRepository($state, linked)
</script>

{#if linked.length > 0}
  <RepositorySelect
    repositories={linked}
    value={shown}
    onChange={(repository) => {
      $state = { repository }
    }}
  />
{/if}
