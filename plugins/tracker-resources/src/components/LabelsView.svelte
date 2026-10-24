<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import tags, { TagElement } from '@hcengineering/tags'
  import { selectedTagElements } from '@hcengineering/tags-resources'
  import { Component, getCurrentResolvedLocation, type Location, navigate } from '@hcengineering/ui'
  import { Filter } from '@hcengineering/view'
  import { buildFilterKey, setFilters } from '@hcengineering/view-resources'
  import tracker from '../plugin'

  function setFilterTag(tag: TagElement, loc: Location) {
    const client = getClient()
    const hierarchy = client.getHierarchy()
    const attribute = hierarchy.getAttribute(tracker.class.Issue, 'labels')
    const key = buildFilterKey(hierarchy, tracker.class.Issue, '_class', attribute)
    const filter = {
      key,
      value: [tag._id],
      props: { level: 0 },
      modes: [tags.filter.FilterTagsIn, tags.filter.FilterTagsNin],
      mode: tags.filter.FilterTagsIn,
      index: 1
    } as unknown as Filter
    setFilters([filter], loc, tracker.class.Issue)
  }
  async function onTag(tag: TagElement): Promise<void> {
    selectedTagElements.set([tag._id])
    const loc = getCurrentResolvedLocation()
    loc.path[2] = 'tracker'
    loc.path[3] = 'all-issues'
    loc.path.length = 4
    navigate(loc)
    setFilterTag(tag, loc)
  }
</script>

<Component
  is={tags.component.TagsView}
  props={{
    targetClass: tracker.class.Issue,
    title: tracker.string.Labels,
    icon: tracker.icon.Labels,
    item: tracker.string.Labels,
    key: 'labels',
    createItemLabel: tracker.string.AddLabel,
    onTag
  }}
></Component>
