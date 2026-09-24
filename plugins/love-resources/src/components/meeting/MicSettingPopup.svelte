<script lang="ts">
  import core, { getCurrentAccount } from '@hcengineering/core'
  import { DevicesPreference } from '@hcengineering/love'
  import { getClient } from '@hcengineering/presentation'
  import { Component, Label, Loading, Toggle } from '@hcengineering/ui'
  import love from '../../plugin'
  import { myPreferences } from '../../stores'
  import { liveKitClient } from '../../utils'
  import mediaPlugin, { getMediaDevices } from '@hcengineering/media'

  const client = getClient()

  function isNoiseCancellationSupported (): boolean {
    try {
      const c = navigator.mediaDevices?.getSupportedConstraints?.() ?? {}
      return c.echoCancellation === true || c.noiseSuppression === true
    } catch {
      return false
    }
  }

  async function saveNoiseCancellationPreference (
    myPreferences: DevicesPreference | undefined,
    value: boolean
  ): Promise<void> {
    if (myPreferences !== undefined) {
      await client.update(myPreferences, { noiseCancellation: value })
    } else {
      const acc = getCurrentAccount().uuid
      await client.createDoc(love.class.DevicesPreference, core.space.Workspace, {
        attachedTo: acc,
        noiseCancellation: value,
        camEnabled: true,
        micEnabled: true,
        blurRadius: 0
      })
    }
    await liveKitClient.applyNoiseCancellation(value)
  }

  async function saveSpeakingWhileMutedPreference (
    myPreferences: DevicesPreference | undefined,
    value: boolean
  ): Promise<void> {
    if (myPreferences !== undefined) {
      await client.update(myPreferences, { speakingWhileMutedAlert: value })
    } else {
      const acc = getCurrentAccount().uuid
      await client.createDoc(love.class.DevicesPreference, core.space.Workspace, {
        attachedTo: acc,
        noiseCancellation: true,
        camEnabled: true,
        micEnabled: true,
        blurRadius: 0,
        speakingWhileMutedAlert: value
      })
    }
  }
</script>

<div class="antiPopup mediaPopup">
  {#await getMediaDevices(true, false)}
    <div class="p-4">
      <Loading />
    </div>
  {:then mediaInfo}
    <Component is={mediaPlugin.component.MediaPopupMicSelector} props={{ mediaInfo }} />
    <Component is={mediaPlugin.component.MediaPopupSpkSelector} props={{ mediaInfo }} />
    <div class="grid p-3">
      {#if isNoiseCancellationSupported()}
        <Label label={love.string.NoiseCancellation} />
        <Toggle
          on={$myPreferences?.noiseCancellation ?? true}
          on:change={(e) => {
            void saveNoiseCancellationPreference($myPreferences, e.detail)
          }}
        />
      {/if}
      <Label label={love.string.SpeakingWhileMutedAlert} />
      <Toggle
        on={$myPreferences?.speakingWhileMutedAlert ?? true}
        on:change={(e) => {
          void saveSpeakingWhileMutedPreference($myPreferences, e.detail)
        }}
      />
    </div>
  {/await}
</div>

<style lang="scss">
  .mediaPopup {
    width: 20rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 1rem;
    column-gap: 1rem;
    align-items: center;
  }
</style>
