<script lang="ts">
  import tags, { TagElement } from '@hcengineering/tags'
  import { Button, Component, getCurrentResolvedLocation, type Location, navigate, showPopup } from '@hcengineering/ui'
  import recruit from '../plugin'
  import { buildFilterKey, setFilters } from '@hcengineering/view-resources'
  import { getClient } from '@hcengineering/presentation'
  import { Filter } from '@hcengineering/view'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import OptimizeSkills from './OptimizeSkills.svelte'
  import { selectedTagElements } from '@hcengineering/tags-resources'

  function setFilterTag(tag: TagElement, loc: Location) {
    const client = getClient()
    const hierarchy = client.getHierarchy()
    const attribute = hierarchy.getAttribute(recruit.mixin.Candidate, 'skills')
    const key = buildFilterKey(hierarchy, recruit.mixin.Candidate, '_class', attribute)
    const filter = {
      key,
      value: [tag._id],
      props: { level: 0 },
      modes: [tags.filter.FilterTagsIn, tags.filter.FilterTagsNin],
      mode: tags.filter.FilterTagsIn,
      index: 1
    } as unknown as Filter
    setFilters([filter], loc, recruit.mixin.Candidate)
  }
  async function onTag(tag: TagElement): Promise<void> {
    selectedTagElements.set([tag._id])
    const loc = getCurrentResolvedLocation()
    loc.path[2] = 'recruit'
    loc.path[3] = 'talents'
    loc.path.length = 4
    navigate(loc)
    setFilterTag(tag, loc)
  }
</script>

<Component
  is={tags.component.TagsView}
  props={{
    targetClass: recruit.mixin.Candidate,
    title: recruit.string.SkillsLabel,
    icon: recruit.icon.Skills,
    item: recruit.string.SkillLabel,
    key: 'skills',
    createItemLabel: recruit.string.SkillCreateLabel,
    onTag
  }}
>
  <Button
    label={getEmbeddedLabel('Optimize')}
    kind={'regular'}
    on:click={() => {
      showPopup(OptimizeSkills, { targetClass: recruit.mixin.Candidate })
    }}
  />
</Component>
