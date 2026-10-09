<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Integration } from '@hcengineering/account-client'
  import { Analytics } from '@hcengineering/analytics'
  import { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { ERROR, OK, type Status } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { BaseIntegrationState } from '@hcengineering/setting-resources'
  import gitlab from '../plugin'

  export let integration: Integration

  const client = getClient()
  let glIntegration: GitlabIntegration | undefined
  let linked: GitlabIntegrationRepository[] = []
  let status: Status | undefined
  let isLoading = true

  $: void load(integration)

  async function load (integration: Integration): Promise<void> {
    try {
      const userId = integration?.data?.gitlabUserId as number | undefined
      glIntegration =
        userId === undefined
          ? undefined
          : await client.findOne(gitlab.class.GitlabIntegration, { gitlabUserId: userId })
      linked =
        glIntegration === undefined
          ? []
          : await client.findAll(gitlab.class.GitlabIntegrationRepository, {
            attachedTo: glIntegration._id,
            enabled: true
          })
      status = glIntegration?.error != null ? ERROR : OK
    } catch (err: unknown) {
      status = ERROR
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      isLoading = false
    }
  }
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
