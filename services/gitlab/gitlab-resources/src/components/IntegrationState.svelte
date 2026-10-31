<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Integration } from '@hcengineering/account-client'
  import { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { ERROR, OK } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { BaseIntegrationState } from '@hcengineering/setting-resources'
  import { reportError } from '../errors'
  import { integrationCardStateOf } from '../integration-card'
  import gitlab from '../plugin'

  export let integration: Integration

  const client = getClient()
  const integrationQuery = createQuery()
  const repositoriesQuery = createQuery()
  let glIntegration: GitlabIntegration | undefined
  let linked: GitlabIntegrationRepository[] = []
  let answered = false
  // A live query never reports a failure; this is set when the probe lookup below fails
  let loadFailed = false

  async function probe(id: number): Promise<void> {
    try {
      await client.findOne(gitlab.class.GitlabIntegration, { gitlabUserId: id })
    } catch (err: unknown) {
      reportError(err)
      // A failure for an integration the card no longer shows changes nothing
      if (id === userId) loadFailed = true
    }
  }

  // Live queries: a later answer for another integration never overwrites the current one
  $: userId = integration?.data?.gitlabUserId as number | undefined
  $: if (userId === undefined) {
    integrationQuery.unsubscribe()
    glIntegration = undefined
    answered = false
    loadFailed = false
  } else {
    answered = false
    loadFailed = false
    void probe(userId)
    integrationQuery.query(
      gitlab.class.GitlabIntegration,
      { gitlabUserId: userId },
      (res) => {
        glIntegration = res[0]
        answered = true
      },
      { limit: 1 }
    )
  }
  $: if (glIntegration === undefined) {
    repositoriesQuery.unsubscribe()
    linked = []
  } else {
    repositoriesQuery.query(
      gitlab.class.GitlabIntegrationRepository,
      { attachedTo: glIntegration._id, enabled: true },
      (res) => {
        linked = res
      }
    )
  }
  $: cardState = integrationCardStateOf({
    hasUser: userId !== undefined,
    answered,
    loadFailed,
    integrationError: glIntegration?.error
  })
  $: status = cardState.hasError ? ERROR : OK
  $: isLoading = cardState.isLoading
</script>

<BaseIntegrationState {integration} {status} {isLoading} value={glIntegration?.login}>
  <svelte:fragment slot="content">
    {#each linked as repository (repository._id)}
      <div class="stat-row">{repository.pathWithNamespace}</div>
    {/each}
  </svelte:fragment>
</BaseIntegrationState>

<style lang="scss">
  .stat-row {
    display: flex;
    font-size: 0.85rem;
    padding: 0.15rem 0;
  }
</style>
