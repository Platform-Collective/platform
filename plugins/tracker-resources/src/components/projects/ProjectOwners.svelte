<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import contact, { type Employee, getName } from '@hcengineering/contact'
  import { CombineAvatars, employeeRefByAccountUuidStore } from '@hcengineering/contact-resources'
  import { type AccountUuid, notEmpty, type Ref } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { tooltip } from '@hcengineering/ui'

  export let owners: AccountUuid[] | undefined = undefined

  let refs: Array<Ref<Employee>> = []
  $: refs = (owners ?? []).map((owner) => $employeeRefByAccountUuidStore.get(owner)).filter(notEmpty)

  let names = ''
  const query = createQuery()
  $: if (refs.length > 0) {
    query.query(contact.mixin.Employee, { _id: { $in: refs } }, (result) => {
      const hierarchy = getClient().getHierarchy()
      names = result.map((employee) => getName(hierarchy, employee)).join(', ')
    })
  } else {
    query.unsubscribe()
    names = ''
  }
</script>

{#if refs.length > 0}
  <div class="project-owners" data-testid="project-owners" use:tooltip={{ label: getEmbeddedLabel(names) }}>
    <CombineAvatars _class={contact.mixin.Employee} items={refs} size={'x-small'} limit={2} />
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
