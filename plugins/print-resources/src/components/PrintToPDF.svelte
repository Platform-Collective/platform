<!--
// Copyright © 2024 Hardcore Engineering Inc.
//
-->

<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { Doc, type Blob, type Ref } from '@hcengineering/core'
  import presentation, { PDFViewer, createQuery, getClient } from '@hcengineering/presentation'
  import guest, { PublicLink, createPublicLink } from '@hcengineering/guest'
  import view from '@hcengineering/view'
  import {
    Button,
    DropdownIntlItem,
    eventToHTMLElement,
    IconCheck,
    IconMoreH,
    Location,
    ModernPopup,
    showPopup
  } from '@hcengineering/ui'
  import { getDocTitle, getObjectLinkFragment } from '@hcengineering/view-resources'
  import { printToPDF, type PrintPageOrientation } from '@hcengineering/print'
  import { signPDF } from '@hcengineering/sign'
  import { getMetadata } from '@hcengineering/platform'
  import branding from '@hcengineering/branding'

  import print from '../plugin'

  export let object: Doc
  export let signed: boolean = false

  const client = getClient()

  let isLoading = true
  let isLinkLoading = true
  let link: PublicLink | undefined = undefined
  let file: Ref<Blob> | undefined = undefined
  let title = ''
  let orientation: PrintPageOrientation = 'portrait'
  let printRequest = 0

  $: objId = object?._id
  $: printSettingsItems = [
    {
      id: 'landscape',
      label: print.string.LandscapeMode,
      icon: orientation === 'landscape' ? IconCheck : undefined
    }
  ] satisfies DropdownIntlItem[]

  function nextPrintRequest(): number {
    printRequest += 1
    return printRequest
  }

  const linkQuery = createQuery()
  $: {
    nextPrintRequest()
    link = undefined
    file = undefined
    isLoading = true
    isLinkLoading = true
    linkQuery.query(
      guest.class.PublicLink,
      { attachedTo: objId },
      (res) => {
        link = res[0]
        isLinkLoading = false
      },
      { limit: 1 }
    )
  }

  $: if (link?.url !== undefined && link.url !== '' && file === undefined) {
    const token = getMetadata(presentation.metadata.Token) ?? ''
    const request = nextPrintRequest()

    printToPDF(link.url, token, { orientation }).then(
      (res) => {
        if (request !== printRequest) {
          return
        }
        if (signed) {
          signPDF(res, token).then(
            (signedRes) => {
              if (request !== printRequest) {
                return
              }
              file = signedRes as Ref<Blob>
              isLoading = false
            },
            (err) => {
              if (request !== printRequest) {
                return
              }
              Analytics.handleError(err)
              isLoading = false
            }
          )
        } else {
          file = res as Ref<Blob>
          isLoading = false
        }
      },
      (err) => {
        if (request !== printRequest) {
          return
        }
        Analytics.handleError(err)
        isLoading = false
      }
    )
  }

  $: if (object !== undefined && !isLinkLoading) {
    void createLinkIfMissing(object)
  }

  async function getObjectLocation(obj: Doc): Promise<Location> {
    const panelComponent = client.getHierarchy().classHierarchyMixin(obj._class, view.mixin.ObjectPanel)
    const comp = panelComponent?.component ?? view.component.EditDoc

    return await getObjectLinkFragment(client.getHierarchy(), obj, {}, comp)
  }

  async function createLinkIfMissing(obj: Doc): Promise<void> {
    if (link?.attachedTo === obj._id) {
      return
    }

    if (link === undefined) {
      const location = await getObjectLocation(obj)

      await createPublicLink(client, obj, location)
    }
  }

  async function updateDocTitle(obj: Doc): Promise<void> {
    const value = (await getDocTitle(client, obj._id, obj._class, obj)) ?? ''
    title = value !== '' ? value + '.pdf' : ''
  }

  function toggleOrientation(): void {
    nextPrintRequest()
    orientation = orientation === 'landscape' ? 'portrait' : 'landscape'
    file = undefined
    isLoading = true
  }

  function handlePrintSetting(id: 'landscape' | 'contentOnly'): void {
    if (id === 'landscape') {
      toggleOrientation()
    }
  }

  function openPrintSettings(event: MouseEvent): void {
    showPopup(
      ModernPopup,
      { items: printSettingsItems },
      eventToHTMLElement(event),
      (result: 'landscape' | 'contentOnly' | undefined) => {
        if (result !== undefined) {
          handlePrintSetting(result)
        }
      }
    )
  }

  $: void updateDocTitle(object)

  let hasTemplates = false
  const templatesQuery = createQuery()
  templatesQuery.query(
    branding.class.PrintTemplate,
    {},
    (res) => {
      hasTemplates = res.length > 0
    },
    { limit: 1, projection: { _id: 1 } }
  )

  function printWithTemplate(): void {
    showPopup(branding.component.PrintPreview, { object, signed }, 'content', (result: string | undefined) => {
      if (result === undefined) return
      // Invalidate the plain print in flight, the composed PDF replaces it
      nextPrintRequest()
      file = result as Ref<Blob>
      isLoading = false
    })
  }
</script>

<PDFViewer {file} name={title} contentType="application/pdf" showIcon={false} {isLoading} on:close on:fullsize>
  <svelte:fragment slot="utils">
    {#if hasTemplates}
      <Button
        icon={branding.icon.Template}
        kind="ghost"
        label={branding.string.PrintWithTemplate}
        disabled={isLinkLoading}
        on:click={printWithTemplate}
      />
    {/if}
    <Button
      icon={IconMoreH}
      kind="ghost"
      disabled={isLinkLoading}
      showTooltip={{ label: print.string.PrintSettings, direction: 'bottom' }}
      on:click={openPrintSettings}
    />
  </svelte:fragment>
</PDFViewer>
