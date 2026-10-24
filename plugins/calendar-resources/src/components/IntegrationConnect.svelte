<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import { getMetadata, translate } from '@hcengineering/platform'
  import { Button, Html, IconClose, IconError, Label, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import calendar from '../plugin'
  import { concatLink } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import { calendarId } from '@hcengineering/calendar'
  import { connectCalendar } from '../connect'

  const dispatch = createEventDispatcher<{ close: void }>()

  function close(): void {
    dispatch('close')
  }

  let connecting = false
  let error = false
  const calendarUrl = getMetadata(calendar.metadata.CalendarServiceURL) ?? ''

  async function sendRequest(): Promise<void> {
    connecting = true
    error = false
    try {
      const link = concatLink(calendarUrl, '/signin')
      const url = new URL(link)
      url.search = new URLSearchParams({
        redirectURL: (getMetadata(presentation.metadata.FrontUrl) ?? window.location.origin) + `/${calendarId}`
      }).toString()

      await connectCalendar(url, getMetadata(presentation.metadata.Token))
      dispatch('close')
    } catch (err) {
      error = true
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      connecting = false
    }
  }

  let label = ''

  async function updateLabel(language: string): Promise<void> {
    label = await translate(calendar.string.GooglePrivacy, {}, language)
  }

  $: updateLabel($themeStore.language).catch(Analytics.handleError)
</script>

<div class="card">
  <div class="flex-between header">
    <div class="overflow-label fs-title"><Label label={calendar.string.ConnectCalendar} /></div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="tool" on:click={close}>
      <IconClose size="small" />
    </div>
  </div>
  <div class="content">
    <div>
      <Label label={calendar.string.RedirectGoogle} />
    </div>
    <div class="mt-2">
      <Html value={label} />
    </div>

    {#if error}
      <div class="flex-row-center gap-2 pt-2" role="alert">
        <IconError size="medium" />
        <Label label={calendar.string.FailedToConnect} />
      </div>
    {/if}

    <img class="image" src={getMetadata(calendar.image.Permissions)} alt="" />
  </div>
  <div class="footer">
    <Button label={calendar.string.Connect} kind="primary" disabled={connecting} on:click={sendRequest} />
  </div>
</div>

<style lang="scss">
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(40rem, calc(100vw - 2rem));
    min-width: 0;
    max-width: min(40rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    max-height: calc(100dvh - 2rem);
    overflow: hidden;
    background-color: var(--popup-bg-hover);
    border-radius: 0.75rem;
    box-shadow: var(--popup-shadow);

    .header {
      flex-shrink: 0;
      margin: 1.75rem 1.75rem 1.25rem;

      .tool {
        cursor: pointer;
        &:hover {
          color: var(--caption-color);
        }
        &:active {
          color: var(--accent-color);
        }
      }
    }

    .content {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      color: var(--theme-content-color);
      margin: 0 1.75rem;
      padding-bottom: 0.5rem;
    }

    .image {
      width: 100%;
      height: auto;
      margin-top: 2rem;
    }

    .footer {
      flex-shrink: 0;
      display: flex;
      flex-direction: row-reverse;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.75rem 1.25rem;
      margin-top: auto;
      background-color: var(--popup-bg-hover);
    }
  }
</style>
