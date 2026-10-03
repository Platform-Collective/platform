<!--
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { type AnySvelteComponent, ButtonIcon, showPopup, closeTooltip } from '@hcengineering/ui'
  import { ViewOptionModel, ViewOptions, Viewlet, type ViewOptionsModel, BuildModelKey } from '@hcengineering/view'
  import view from '../plugin'
  import { getViewOptions, viewOptionStore, defaultOptions } from '../viewOptions'
  import ViewOptionsButton from './ViewOptionsButton.svelte'
  import ViewletSetting from './ViewletSetting.svelte'
  import { restrictionStore } from '../utils'

  export let kind: 'primary' | 'secondary' | 'tertiary' | 'negative' = 'secondary'
  export let viewOptions: ViewOptions | undefined = undefined
  export let viewlet: Viewlet | undefined = undefined
  export let disabled: boolean = false
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let defaultViewOptions: ViewOptions | undefined = undefined
  export let defaultConfig: (BuildModelKey | string)[] | undefined = undefined
  /**
   * When false, the ViewOptionsButton (filter / group-by / sort) is hidden
   * entirely and only the Configure-columns ButtonIcon renders. List mode
   * leaves this at the default `true`.
   */
  export let showViewOptions: boolean = true

  /** Columns of the active saved view, shown in the configure popup instead of the global preference */
  export let configOverride: (BuildModelKey | string)[] | undefined = undefined
  /** Receives column edits instead of the global ViewletPreference (used by saved views) */
  export let onSaveConfig: ((config: Array<BuildModelKey | string>) => void) | undefined = undefined

  /**
   * When true, the ViewOptionsButton is still shown but the popup it
   * opens hides its grouping + ordering rows. Use this in viewlets that
   * render dedicated group-by/sort controls of their own (e.g. the Gantt
   * toolbar) so users do not see the same control twice without a wire.
   * The popup's "other" toggles (bar labels, confirm-dialogs, etc.) keep
   * rendering normally.
   */
  export let hideGroupingAndOrdering: boolean = false

  /**
   * Hides only the "Group by" rows of the options popup, for a layout that has no groups (a calendar: the day is the
   * group). Sorting stays. Forwarded to ViewOptionsButton → ViewOptions.
   */
  export let hideGrouping: boolean = false

  /**
   * Keys in this list are skipped from the popup's "other" rendering.
   * Forwarded to ViewOptionsButton → ViewOptions. Use it when a viewlet
   * renders the same ViewOption elsewhere (e.g. Gantt has a toolbar
   * `Group by` dropdown for `ganttGroupBy`, so the popup duplicate
   * is hidden).
   */
  export let hideKeys: string[] = []

  /**
   * Settings of the layout that are not part of the generic options; shown after the generic rows of the
   * options popup. Forwarded to ViewOptionsButton → ViewOptions.
   */
  export let extraOptions: { component: AnySvelteComponent, props?: Record<string, any> } | undefined = undefined

  /**
   * When false, the Configure-columns ButtonIcon is hidden. List mode keeps
   * the default `true` (column visibility is meaningful there). Gantt mode
   * passes false because the Gantt sidebar uses its own ganttSidebarShow*
   * ViewOptions and the standard column config has no effect there.
   */
  export let showConfigureColumns: boolean = true

  let btn: HTMLButtonElement
  let pressed: boolean = false

  function clickHandler () {
    pressed = true
    closeTooltip()
    showPopup(ViewletSetting, { viewlet, defaultConfig, configOverride, onSaveConfig }, btn, () => {
      pressed = false
    })
  }

  function getDefaults (viewOptions: ViewOptionsModel): ViewOptions {
    const res: ViewOptions = {
      groupBy: [viewOptions.defaultGroupBy ?? viewOptions.groupBy[0] ?? defaultOptions.groupBy[0]],
      orderBy: viewOptions.orderBy?.[0] ?? defaultOptions.orderBy
    }
    for (const opt of viewOptions.other) {
      res[opt.key] = opt.defaultValue
    }
    return res
  }

  function getDefaultOptions (): ViewOptions {
    if (defaultViewOptions != null) return defaultViewOptions

    return viewlet?.viewOptions != null ? getDefaults(viewlet.viewOptions) : defaultOptions
  }

  $: viewOptions = getViewOptions(viewlet, $viewOptionStore, getDefaultOptions())

  $: disabled = $restrictionStore.readonly
</script>

{#if viewlet}
  {#if viewOptions && showViewOptions}
    <ViewOptionsButton
      {viewlet}
      {kind}
      {viewOptions}
      {viewOptionsConfig}
      {hideGroupingAndOrdering}
      {hideGrouping}
      {hideKeys}
      extra={extraOptions}
    />
  {/if}
  {#if showConfigureColumns}
    <!-- Configure-columns button gets its own IntlString so the tooltip differs
       from the sibling ViewOptionsButton (which keeps "Customize view"). -->
    <ButtonIcon
      icon={view.icon.Configure}
      {disabled}
      {kind}
      size={'small'}
      {pressed}
      tooltip={{ label: view.string.ConfigureColumns, direction: 'bottom' }}
      dataId={'btn-viewSetting'}
      bind:element={btn}
      on:click={clickHandler}
    />
  {/if}
{/if}
