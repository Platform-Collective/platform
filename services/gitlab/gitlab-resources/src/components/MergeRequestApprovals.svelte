<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { PersonRefPresenter } from '@hcengineering/contact-resources'
  import { type GitlabMergeRequest } from '@hcengineering/gitlab'
  import { getClient } from '@hcengineering/presentation'
  import { Button, Label } from '@hcengineering/ui'
  import { reportError } from '../errors'
  import gitlab from '../plugin'
  import { gitlabAuthentication } from './authentication'
  import ErrorText from './ErrorText.svelte'

  export let mergeRequest: GitlabMergeRequest

  const me = getCurrentEmployee()

  let sending = false
  let error: unknown
  $: connected = $gitlabAuthentication !== undefined && $gitlabAuthentication.error == null
  $: approvers = mergeRequest.approvedBy ?? []
  $: approved = approvers.includes(me)
  $: open = mergeRequest.state === 'opened' || mergeRequest.state === 'locked'

  // The GitLab service approves or revokes with this user's own GitLab token
  async function send (state: 'approved' | 'unapproved'): Promise<void> {
    sending = true
    error = undefined
    try {
      await getClient().addCollection(
        gitlab.class.GitlabReview,
        mergeRequest.space,
        mergeRequest._id,
        mergeRequest._class,
        'activity',
        { state }
      )
    } catch (err: unknown) {
      error = err
      reportError(err)
    } finally {
      sending = false
    }
  }
</script>

<div class="flex-row-center mt-6">
  <Label label={gitlab.string.ApprovedBy} />
  {#each approvers as person (person)}
    <div class="ml-2"><PersonRefPresenter value={person} /></div>
  {/each}
  {#if open}
    <div class="flex-grow" />
    {#if connected}
      <Button
        kind={approved ? 'regular' : 'primary'}
        label={approved ? gitlab.string.RevokeApproval : gitlab.string.Approve}
        loading={sending}
        on:click={() => {
          void send(approved ? 'unapproved' : 'approved')
        }}
      />
    {:else}
      <Label label={gitlab.string.ConnectToApprove} />
    {/if}
  {/if}
</div>
{#if error !== undefined}<ErrorText {error} />{/if}
