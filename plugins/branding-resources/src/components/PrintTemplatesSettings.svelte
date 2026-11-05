<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import core from '@hcengineering/core'
  import { type PrintTemplate, type TemplateType, getTemplateType, isPresetTemplateType } from '@hcengineering/branding'
  import { MessageBox, createQuery, getClient } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    Button,
    Header,
    IconAdd,
    IconCopy,
    IconDelete,
    IconEdit,
    IconMoreH,
    Label,
    Loading,
    Scroller,
    SelectPopup,
    eventToHTMLElement,
    languageStore,
    showPopup
  } from '@hcengineering/ui'
  import { translate } from '@hcengineering/platform'

  import { clone } from '../editor/utils'
  import branding from '../plugin'
  import AssetPicker from './editor/AssetPicker.svelte'
  import TemplateThumbnail from './TemplateThumbnail.svelte'
  import { SAMPLE_VALUES, collectTemplateTypes, templateTypeLabel } from '../sample'
  import { chooseTypeAndCreate, editTemplate as edit } from '../templates'

  // Shows only templates of this type (sidebar sections), all types when undefined
  export let templateType: TemplateType | undefined = undefined

  const client = getClient()
  const query = createQuery()

  let templates: PrintTemplate[] = []
  let loading = true

  query.query(
    branding.class.PrintTemplate,
    {},
    (res) => {
      templates = res
      loading = false
    },
    { sort: { name: 1 } }
  )

  $: groups = collectTemplateTypes(templates)
    .filter((type) => templateType === undefined || type === templateType)
    .map((type) => ({
    type,
    items: templates.filter((t) => getTemplateType(t) === type)
  })).filter((g) => g.items.length > 0)

  function chooseType (e: MouseEvent): void {
    chooseTypeAndCreate(
      eventToHTMLElement(e),
      templateType !== undefined && isPresetTemplateType(templateType) ? templateType : undefined
    )
  }

  async function duplicate (template: PrintTemplate): Promise<void> {
    const suffix = await translate(branding.string.Copy, {}, $languageStore)
    await client.createDoc(branding.class.PrintTemplate, core.space.Workspace, {
      name: `${template.name} (${suffix})`,
      description: template.description,
      templateType: template.templateType,
      design: clone(template.design),
      targetClasses: template.targetClasses,
      isDefault: false
    })
  }

  async function setDefault (template: PrintTemplate): Promise<void> {
    const ops = client.apply()
    for (const t of templates) {
      if (t.isDefault === true && t._id !== template._id) {
        await ops.update(t, { isDefault: false })
      }
    }
    await ops.update(template, { isDefault: true })
    await ops.commit()
  }

  function remove (template: PrintTemplate): void {
    showPopup(
      MessageBox,
      {
        label: branding.string.DeleteTemplate,
        message: branding.string.DeleteTemplateConfirm,
        params: { name: template.name },
        dangerous: true,
        action: async () => {
          await client.remove(template)
        }
      },
      'top'
    )
  }

  function openMenu (e: MouseEvent, template: PrintTemplate): void {
    const actions: Record<string, () => Promise<void> | void> = {
      edit: () => {
        edit(template)
      },
      duplicate: async () => {
        await duplicate(template)
      },
      default: async () => {
        await setDefault(template)
      },
      delete: () => {
        remove(template)
      }
    }
    showPopup(
      SelectPopup,
      {
        value: [
          { id: 'edit', label: branding.string.EditTemplate, icon: IconEdit },
          { id: 'duplicate', label: branding.string.DuplicateTemplate, icon: IconCopy },
          ...(template.isDefault === true ? [] : [{ id: 'default', label: branding.string.SetAsDefault, icon: branding.icon.Branding }]),
          { id: 'delete', label: branding.string.DeleteTemplate, icon: IconDelete }
        ]
      },
      eventToHTMLElement(e),
      (id: string | undefined) => {
        if (id === undefined) return
        Promise.resolve(actions[id]?.()).catch((err: unknown) => {
          Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
        })
      }
    )
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb
      icon={branding.icon.Template}
      label={templateType !== undefined ? templateTypeLabel(templateType) : branding.string.PrintTemplates}
      size={'large'}
      isCurrent
    />
    <svelte:fragment slot="actions">
      <Button
        label={branding.string.Assets}
        kind={'regular'}
        on:click={(e) => showPopup(AssetPicker, { kind: 'image', manage: true }, eventToHTMLElement(e))}
      />
      <Button
        label={branding.string.Fonts}
        kind={'regular'}
        on:click={(e) => showPopup(AssetPicker, { kind: 'font', manage: true }, eventToHTMLElement(e))}
      />
      <Button icon={IconAdd} label={branding.string.CreateTemplate} kind={'primary'} on:click={chooseType} />
    </svelte:fragment>
  </Header>

  <Scroller padding={'var(--spacing-3)'}>
    {#if loading}
      <Loading />
    {:else if groups.length === 0}
      <div class="empty">
        <Label label={branding.string.NoTemplates} />
        <Button icon={IconAdd} label={branding.string.CreateTemplate} kind={'primary'} on:click={chooseType} />
      </div>
    {:else}
      {#each groups as group (group.type)}
      <div class="group-title"><Label label={templateTypeLabel(group.type)} /><span class="count">{group.items.length}</span></div>
      <div class="grid">
        {#each group.items as template (template._id)}
          <div class="card">
            <button type="button" class="preview" on:click={() => edit(template)}>
              <TemplateThumbnail design={template.design} width={150} values={SAMPLE_VALUES} />
            </button>
            <div class="info">
              <span class="name overflow-label">{template.name}</span>
              {#if template.isDefault === true}
                <span class="badge"><Label label={branding.string.Default} /></span>
              {/if}
              <Button icon={IconMoreH} kind={'ghost'} size={'small'} on:click={(e) => openMenu(e, template)} />
            </div>
          </div>
        {/each}
      </div>
      {/each}
    {/if}
  </Scroller>
</div>

<style lang="scss">
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 4rem 1rem;
    color: var(--theme-dark-color);
  }
  .group-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 1rem 0 0.75rem;
    font-weight: 600;
    color: var(--theme-caption-color);

    &:first-child {
      margin-top: 0;
    }
    .count {
      font-weight: 400;
      font-size: 0.75rem;
      color: var(--theme-dark-color);
    }
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 1rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-button-default);
    overflow: hidden;

    &:hover {
      border-color: var(--theme-button-border);
    }
  }
  .preview {
    display: flex;
    justify-content: center;
    padding: 1rem;
    border: none;
    background: var(--theme-bg-dark-color);
    cursor: pointer;
  }
  .info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  }
  .name {
    flex-grow: 1;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .badge {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    background: var(--primary-button-default);
    color: var(--primary-button-color);
  }
</style>
