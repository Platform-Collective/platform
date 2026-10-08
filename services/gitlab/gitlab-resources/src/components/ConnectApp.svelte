<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { getMetadata, type IntlString } from '@hcengineering/platform'
  import ui, { Button, Label, Location, Spinner, location } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import gitlab from '../plugin'
  import {
    OAUTH_CHANNEL,
    OAUTH_RESULT_TIMEOUT_MS,
    isOAuthResultMessage,
    oauthCallbackMessage,
    oauthErrorMessage
  } from '../state'

  // This tab has no Huly session: it never calls the pod. It hands the OAuth callback to the
  // opener (Connect dialog, which has the session) and waits for its result.
  let phase: 'waiting' | 'success' | 'failed' = 'waiting'
  let failureLabel: IntlString | undefined
  let failureMessage: string | undefined
  let autoClose = 3
  let interval: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let channel: BroadcastChannel | undefined
  let started = false

  const title = getMetadata(ui.metadata.PlatformTitle)

  function doAutoClose (): void {
    interval = setInterval(() => {
      autoClose = autoClose - 1
      if (autoClose <= 0) {
        clearInterval(interval)
        window.close()
      }
    }, 1000)
  }

  function fail (message?: string, label?: IntlString): void {
    clearTimeout(timeout)
    phase = 'failed'
    failureMessage = message
    failureLabel = label
    if (message !== undefined || label !== undefined) {
      Analytics.handleError(new Error(`GitLab OAuth callback failed: ${message ?? label}`))
    }
  }

  function openChannel (): BroadcastChannel | undefined {
    if (typeof BroadcastChannel === 'undefined') return undefined
    return new BroadcastChannel(OAUTH_CHANNEL)
  }

  function handle (loc: Location): void {
    if (started) return
    const query = loc.query ?? {}
    const error = query.error
    const code = query.code
    const state = query.state
    if (error != null) {
      started = true
      const description = query.error_description ?? undefined
      // Tell the opener (best effort) and show GitLab's reason here; never close silently.
      openChannel()?.postMessage(oauthErrorMessage(error, description))
      fail(description ?? error)
      return
    }
    if (code == null || state == null) {
      // Not started: a later location update may still carry the callback parameters.
      fail()
      return
    }
    started = true
    phase = 'waiting'
    channel = openChannel()
    if (channel === undefined) {
      fail(undefined, gitlab.string.KeepSettingsOpen)
      return
    }
    channel.onmessage = (ev: MessageEvent) => {
      const msg: unknown = ev.data
      if (!isOAuthResultMessage(msg) || msg.state !== state || phase !== 'waiting') return
      clearTimeout(timeout)
      if (msg.ok) {
        phase = 'success'
        doAutoClose()
      } else {
        fail(msg.error)
      }
    }
    timeout = setTimeout(() => {
      if (phase === 'waiting') fail(undefined, gitlab.string.KeepSettingsOpen)
    }, OAUTH_RESULT_TIMEOUT_MS)
    channel.postMessage(oauthCallbackMessage(code, state))
  }

  onDestroy(location.subscribe(handle))
  onDestroy(() => {
    clearInterval(interval)
    clearTimeout(timeout)
    channel?.close()
  })
</script>

<div class="flex flex-center fs-title text-center items-center h-full w-full">
  {#if phase === 'waiting'}
    <div class="flex flex-row-center flex-center flex-grow">
      <Spinner />
      <div class="ml-1"><Label label={gitlab.string.Processing} /></div>
    </div>
  {:else if phase === 'success'}
    <Label label={gitlab.string.AutoClose} params={{ time: autoClose }} />
  {:else}
    <div class="flex flex-col flex-center flex-gap-4">
      <Label label={gitlab.string.RequestFailed} />
      {#if failureLabel !== undefined}
        <span class="error-color"><Label label={failureLabel} params={{ title }} /></span>
      {:else if failureMessage !== undefined}
        <span class="error-color">{failureMessage}</span>
      {/if}
      <Button label={gitlab.string.CloseTab} kind="primary" on:click={() => { window.close() }} />
    </div>
  {/if}
</div>
