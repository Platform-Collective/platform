<!--
// Copyright © 2026 Intabia Fusion.
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
  // GuestApp: full-screen application that handles guest join flow.
  // It watches location query params (meetingId, guestToken), requests `/guestInfo`
  // and attempts to auto-resolve/select the workspace (via login.function.SelectWorkspace).
  // If workspace can be selected and returns a token, we navigate to the workspace+meeting.
  // Otherwise we remain on the public Guest flow (GuestJoinPopup).

  import GuestJoinPopup from './GuestJoinPopup.svelte'
  import ScreenSharingView from '../meeting/ScreenSharingView.svelte'
  import GuestParticipantsListView from './GuestParticipantsListView.svelte'
  import { lkSessionConnected } from '../../liveKitClient'
  import { isFullScreen, liveKitClient } from '../../utils'
  import { onDestroy, onMount } from 'svelte'
  import ui, { location, navigate, Location, Button, ticker, formatDuration, themeStore } from '@hcengineering/ui'
  import { getMetadata, getResource, IntlString } from '@hcengineering/platform'
  import login from '@hcengineering/login'

  import love from '../../plugin'
  import { MeetingMinutes, MeetingStatus } from '@hcengineering/love'
  import { workbenchId } from '@hcengineering/workbench'
  import GuestControlBar from './GuestControlBar.svelte'
  import { Ref, Timestamp, WorkspaceUuid } from '@hcengineering/core'

  import { LoginAppBase, loginTheme, Label } from '@hcengineering/login-resources'
  import loginResources from '@hcengineering/login-resources/src/plugin'

  import { type Room as LKRoom, RoomEvent, type RemoteParticipant } from 'livekit-client'

  // Timeout constants for guests-only check
  const GUEST_ONLY_CHECK_INTERVAL_MS = 5000 // Check every 5 seconds
  const GUEST_ONLY_TIMEOUT_MS = 30000 // 30 seconds timeout before leaving

  // Route params
  let guestToken: string | undefined = undefined
  let errorMessage: IntlString | null = null

  export const lk: LKRoom = liveKitClient.liveKitRoom

  // Guest info / resolution state
  let guestInfo: {
    meetingId: Ref<MeetingMinutes>
    workspace: WorkspaceUuid
    workspaceUrl: string
    now: Timestamp
    meetingStatus: MeetingStatus
    meetingScheduledDate?: Timestamp
    meetingEnd?: Timestamp
    roomFound: boolean
    title: string
  } | null = null
  let resolving = false
  let resolveError: string | null = null
  // Last guest token we fetched info for, so we fetch exactly once per token change.
  let lastFetchedToken: string | undefined
  // When we fail to fetch guest info, surface the error to the UI
  // (resolveError will be displayed in the modal)

  // ref to GuestJoinPopup to trigger join programmatically
  let guestJoinRef: any = null

  // Guest-only detection
  let guestOnlyCheckInterval: number | undefined
  let guestOnlyTimeout: number | undefined

  // Live view state for guest presentation
  let withScreenSharing: boolean = false
  let gridStyle = ''
  let columns: number = 0
  let rows: number = 0
  const guestRoomPlaceholder: any = undefined

  function updateStyle (count: number, screenSharing: boolean): void {
    columns = screenSharing ? 1 : Math.min(Math.ceil(Math.sqrt(count)), 8)
    rows = Math.ceil(count / columns)
    gridStyle = `grid-template-columns: repeat(${columns}, 1fr); aspect-ratio: ${columns * 1280}/${rows * 720};`
  }

  async function leaveGuest (): Promise<void> {
    try {
      await liveKitClient.disconnect()
    } catch (err: any) {
      console.error('Failed to disconnect guest', err)
    }
  }

  // Check if there are any non-guest participants in the room
  function checkForNonGuestParticipants (): void {
    if (!lk || !$lkSessionConnected) return

    // Get all remote participants
    const remoteParticipants = Array.from(lk.remoteParticipants.values())

    // Filter out agents/bots (kind === 4 is agent) from remote participants
    const humanRemoteParticipants = remoteParticipants.filter((p) => p.kind !== 4 && p.permissions?.agent !== true)

    let nonGuestCount = 0
    let guestCount = 0

    // Check remote participants only (local is always a guest in this component)
    for (const p of humanRemoteParticipants) {
      try {
        const metadata = p.metadata ? JSON.parse(p.metadata) : null
        if (metadata?.isGuest === true) {
          guestCount++
        } else {
          nonGuestCount++
        }
      } catch {
        // If can't parse metadata, assume non-guest
        nonGuestCount++
      }
    }

    console.log('[GuestMeetingApp] Checking remote participants:', {
      totalRemote: remoteParticipants.length,
      humanRemoteParticipants: humanRemoteParticipants.length,
      nonGuestCount,
      guestCount
    })

    if (nonGuestCount === 0) {
      // Only guests present (any number, including just self), start timeout
      if (guestOnlyTimeout === undefined) {
        console.log('[GuestMeetingApp] Only guests detected (no regular users), starting leave timeout')
        guestOnlyTimeout = window.setTimeout(() => {
          console.log('[GuestMeetingApp] Guest-only timeout reached, leaving meeting')
          void leaveGuest()
        }, GUEST_ONLY_TIMEOUT_MS)
      }
    } else {
      // Found non-guest participant, clear timeout
      if (guestOnlyTimeout !== undefined) {
        console.log('[GuestMeetingApp] Non-guest participant found, clearing timeout')
        clearTimeout(guestOnlyTimeout)
        guestOnlyTimeout = undefined
      }
    }
  }

  function onParticipantConnected (_participant: RemoteParticipant): void {
    console.log('[GuestMeetingApp] Participant connected:', _participant.identity)
    // Recheck when someone joins
    checkForNonGuestParticipants()
  }

  function onParticipantDisconnected (_participant: RemoteParticipant): void {
    console.log('[GuestMeetingApp] Participant disconnected:', _participant.identity)
    // Recheck when someone leaves
    checkForNonGuestParticipants()
  }

  function startGuestOnlyCheck (): void {
    if (guestOnlyCheckInterval !== undefined) return

    console.log('[GuestMeetingApp] Starting guest-only check')
    // Initial check
    checkForNonGuestParticipants()

    // Set up interval to check periodically
    guestOnlyCheckInterval = window.setInterval(() => {
      checkForNonGuestParticipants()
    }, GUEST_ONLY_CHECK_INTERVAL_MS)
  }

  function stopGuestOnlyCheck (): void {
    console.log('[GuestMeetingApp] Stopping guest-only check')
    if (guestOnlyCheckInterval !== undefined) {
      clearInterval(guestOnlyCheckInterval)
      guestOnlyCheckInterval = undefined
    }
    if (guestOnlyTimeout !== undefined) {
      clearTimeout(guestOnlyTimeout)
      guestOnlyTimeout = undefined
    }
  }

  function handleLocation (loc: Location): void {
    if (loc.path[0] !== 'meetings') {
      return
    }
    const q = loc.query ?? {}

    guestToken = q.guestToken ?? undefined

    if (guestToken == null) {
      errorMessage = love.string.InvalidOrExpiredLink
      guestInfo = null
    } else {
      errorMessage = null
      // Guest info is fetched by the reactive block below, once per token change.
    }
  }

  async function fetchGuestInfo (): Promise<void> {
    if (guestToken == null) return

    lastFetchedToken = guestToken
    resolving = true
    resolveError = null

    try {
      const endpoint = getMetadata(love.metadata.ServiceEndpoint)
      if (endpoint == null || endpoint === '') {
        throw new Error('Love service endpoint not found')
      }

      const resp = await fetch(`${endpoint}/guestInfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: guestToken })
      })

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        throw new Error(`Failed to fetch guest info: ${resp.status} ${txt}`)
      }

      const data = await resp.json()
      guestInfo = data

      if (guestInfo === undefined) {
        return
      }

      // Attempt automatic workspace resolve/select if URL is present
      const wsUrl = guestInfo?.workspaceUrl ?? guestInfo?.workspace ?? null
      if (wsUrl != null) {
        try {
          const selectFn = await getResource(login.function.SelectWorkspace)
          const selectResult = await selectFn?.(wsUrl, null, false)
          const [, loginInfo, ok] = selectResult ?? [undefined, null, false]
          // If selection completed successfully and returned login token — perform login/navigation
          if (ok && loginInfo?.token != null) {
            const fragment = `view:component:EditDoc|${guestInfo?.meetingId}|love:class:MeetingMinutes|content`
            navigate({ path: [workbenchId, wsUrl, 'love'], fragment }, true)
          }
        } catch (err: any) {
          // Swallow error — we'll remain in Public Guest flow
          console.error('selectWorkspace failed', err)
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch guest info', err)
      resolveError = err?.message ?? String(err)
    } finally {
      resolving = false
    }
  }

  // Fetch guest info once per token change — never from $ticker, which would POST
  // /guestInfo every second and re-run workspace select/navigate on each tick.
  $: if (guestToken != null && guestToken !== lastFetchedToken) {
    void fetchGuestInfo()
  }

  onMount(() => {
    roomEl && roomEl.addEventListener('fullscreenchange', handleFullScreen)

    // Subscribe to LiveKit events for guest-only detection
    if (lk) {
      lk.on(RoomEvent.ParticipantConnected, onParticipantConnected)
      lk.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    }

    // Start checking when connected
    const unsubscribe = lkSessionConnected.subscribe((connected) => {
      if (connected) {
        startGuestOnlyCheck()
      } else {
        stopGuestOnlyCheck()
      }
    })

    return () => {
      unsubscribe()
      stopGuestOnlyCheck()
      if (lk) {
        lk.off(RoomEvent.ParticipantConnected, onParticipantConnected)
        lk.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      }
    }
  })

  // Subscribe to location and ensure subscription is cleaned up automatically
  onDestroy(
    location.subscribe((loc) => {
      handleLocation(loc)
    })
  )

  // Ensure LiveKit is disconnected when this component is destroyed (e.g., modal closed)
  onDestroy(() => {
    stopGuestOnlyCheck()
    if ($lkSessionConnected) {
      void liveKitClient.disconnect().catch((err: any) => {
        console.error('Failed to disconnect LiveKit on destroy', err)
      })
    }
  })

  function goHome (): void {
    // Navigate to root (workbench) - adjust if you prefer a different location
    navigate({ path: [] })
  }

  let roomEl: HTMLDivElement

  const handleFullScreen = () => ($isFullScreen = document.fullscreenElement != null)

  function checkFullscreen (): void {
    const needFullScreen = $isFullScreen
    if (document.fullscreenElement && !needFullScreen) {
      document
        .exitFullscreen()
        .then(() => {
          $isFullScreen = false
        })
        .catch((err) => {
          console.log(`Error exiting fullscreen mode: ${err.message} (${err.name})`)
          $isFullScreen = false
        })
    } else if (!document.fullscreenElement && needFullScreen && roomEl != null) {
      roomEl
        .requestFullscreen()
        .then(() => {
          $isFullScreen = true
        })
        .catch((err) => {
          console.log(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`)
          $isFullScreen = false
        })
    }
  }

  function onFullScreen (): void {
    const needFullScreen = !$isFullScreen
    if (!document.fullscreenElement && needFullScreen && roomEl != null) {
      roomEl
        .requestFullscreen()
        .then(() => {
          $isFullScreen = true
        })
        .catch((err) => {
          console.log(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`)
          $isFullScreen = false
        })
    } else if (!needFullScreen) {
      document
        .exitFullscreen()
        .then(() => {
          $isFullScreen = false
        })
        .catch((err) => {
          console.log(`Error exiting fullscreen mode: ${err.message} (${err.name})`)
          $isFullScreen = false
        })
    }
  }
  $: if (((document.fullscreenElement && !$isFullScreen) || $isFullScreen) && roomEl) checkFullscreen()
  $: updateStyle(lk.numParticipants, withScreenSharing)
  $: now = $ticker

  let duration: string
  $: durValue = (guestInfo?.meetingScheduledDate ?? 0) - now
  $: void formatDuration(durValue, $themeStore.language).then((res) => {
    duration = res
  })
</script>

<LoginAppBase wide={$lkSessionConnected ?? false}>
  <svelte:fragment slot="form-content">
    {#if $loginTheme.showLoginTitle}
      <div class="center main-heading mb-4">
        <Label
          className="login-label main-heading__label"
          variant="heading"
          label={loginResources.string.SignToProceed}
        />
      </div>
    {/if}
    {#if guestInfo?.meetingStatus === MeetingStatus.Finished}
      <div class="center">
        <div class="message flex flex-col justify-center">
          <div class="flex flex-row-center justify-center fs-title mb-2">
            <Label label={love.string.Meeting} />
            <div class="p-1">{guestInfo.title ?? ''}</div>
            <Label label={love.string.Finished} />
          </div>
        </div>
      </div>
    {:else if guestInfo != null && guestInfo.meetingStatus === MeetingStatus.Scheduled}
      <div class="center">
        <div class="message flex flex-col items-center">
          <div class="flex flex-col flex-row-center">
            <div class="flex flex-row-center">
              <Label label={love.string.Meeting} />
              <div class="p-1">{guestInfo.title ?? ''}</div>
            </div>
            <div class="ml-2 flex flex-row-center">
              <Label label={love.string.ScheduledIn} />
              {#if durValue > 0}
                <span class="p-1 duration">
                  {duration}
                </span>
              {/if}
            </div>
          </div>
          <Label label={love.string.WaitForHost} />
        </div>
      </div>
    {:else if errorMessage}
      <div class="center" role="alert">
        <div class="message">{errorMessage}</div>
        <div class="actions">
          <Button on:click={goHome} label={ui.string.Back}></Button>
        </div>
      </div>
    {:else if guestToken}
      {#if resolving}
        <div class="center">
          <div class="message flex justify-center">{love.string.CheckingLink}</div>
        </div>
      {:else if $lkSessionConnected}
        <div bind:this={roomEl} class="flex-col-center w-full h-full">
          <div class="room-container" class:sharing={withScreenSharing}>
            <div class="screenContainer">
              <ScreenSharingView bind:hasActiveTrack={withScreenSharing} />
            </div>
            <div class="videoGrid" style={withScreenSharing ? '' : gridStyle} class:scroll-m-0={withScreenSharing}>
              <GuestParticipantsListView
                room={guestRoomPlaceholder}
                on:participantsCount={(evt) => {
                  updateStyle(evt.detail, withScreenSharing)
                }}
              />
            </div>
          </div>
          <GuestControlBar {leaveGuest} {onFullScreen} />
        </div>
      {:else if guestInfo != null}
        <div>
          <div class="flex flex-col justify-center fs-title mb-2">
            {#if guestInfo.workspaceUrl !== ''}
              <div class="message flex flex-row-center justify-center">
                <Label label={love.string.Meeting} />
                <div class="p-1">
                  {guestInfo.title ?? ''}
                </div>
                -
                <div class="p-1">{guestInfo.workspaceUrl}</div>
              </div>
            {/if}
            {#if resolveError}
              <div class="message" role="alert">{love.string.Error}: {resolveError}</div>
            {/if}
          </div>

          <!-- Show join UI (handles name prompt and connecting to LiveKit).
                       We pass workspace info so GuestJoinPopup can persist guest-id / prefill name. -->
          <GuestJoinPopup
            bind:this={guestJoinRef}
            meetingId={guestInfo.meetingId}
            {guestToken}
            workspaceId={guestInfo.workspace ?? undefined}
            workspaceName={guestInfo.workspaceUrl ?? undefined}
          />
        </div>
      {/if}
    {:else}
      <!-- In case location hasn't been populated yet we show a small loader/placeholder -->
      <div class="center">
        <div class="message">{love.string.PreparingGuestConnection}</div>
      </div>
    {/if}
  </svelte:fragment>
</LoginAppBase>

<style lang="scss">
  .error {
    font-weight: 500;
    font-size: 1.5rem;
    align-items: center;
  }
  .duration {
    color: var(--accent-color-base);
  }
  .room-container {
    display: flex;
    justify-content: center;
    padding: 1rem;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;

    .screenContainer {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      max-height: 100%;
      min-height: 0;
      width: 100%;
      border-radius: 0.75rem;

      .screen {
        object-fit: contain;
        max-width: 100%;
        max-height: 100%;
        height: 100%;
        width: 100%;
        border-radius: 0.75rem;
      }
    }
    &:not(.sharing) {
      gap: 0;

      .videoGrid {
        display: grid;
        grid-auto-rows: 1fr;
        justify-content: center;
        align-items: center;
        gap: 1rem;
        max-height: 100%;
        max-width: 100%;
      }
      .screenContainer {
        display: none;
      }
    }
    &.sharing {
      gap: 1rem;

      .videoGrid {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin: 0.5rem 0;
        padding: 0 0.5rem;
        width: 15rem;
        min-width: 15rem;
        min-height: 0;
        max-width: 15rem;
      }
    }

    &.many {
      padding: 0.5rem;

      &:not(.sharing) .videoGrid,
      &.sharing {
        gap: 0.5rem;
      }
    }

    &.mobile {
      padding: var(--spacing-0_5);

      &:not(.sharing) .videoGrid,
      &.sharing {
        gap: var(--spacing-0_5);
      }
    }
  }
  .hidden {
    display: none;
  }
  /* Main heading (title above tabs/signup/login) */
  .main-heading {
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 28px;
    font-style: Bold;
  }
</style>
