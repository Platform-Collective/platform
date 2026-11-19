<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import contact, { type Employee, getName } from '@hcengineering/contact'
  import { CombineAvatars, employeeByIdStore, employeeRefByAccountUuidStore } from '@hcengineering/contact-resources'
  import { type AccountUuid, notEmpty, type Ref } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { tooltip } from '@hcengineering/ui'

  export let owners: AccountUuid[] | undefined = undefined

  const hierarchy = getClient().getHierarchy()
  let refs: Array<Ref<Employee>> = []
  $: refs = (owners ?? []).map((owner) => $employeeRefByAccountUuidStore.get(owner)).filter(notEmpty)
  $: names = refs
    .map((ref) => $employeeByIdStore.get(ref))
    .filter(notEmpty)
    .map((employee) => getName(hierarchy, employee))
    .join(', ')
</script>

{#if refs.length > 0}
  <div
    class="project-owners"
    data-testid="project-owners"
    aria-hidden="true"
    use:tooltip={{ label: getEmbeddedLabel(names) }}
  >
    <CombineAvatars _class={contact.mixin.Employee} items={refs} size="x-small" limit={2} />
  </div>
{/if}

<style lang="scss">
  .project-owners {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    margin-left: 0.25rem;
  }
</style>
