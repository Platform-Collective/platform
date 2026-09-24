import {
  ConnectionState,
  type RemoteParticipant,
  Room as LKRoom,
  RoomEvent,
  type VideoCaptureOptions,
  type RemoteTrack,
  type RemoteTrackPublication,
  Track,
  type LocalTrackPublication,
  type LocalParticipant,
  type TrackPublication,
  type Participant
} from 'livekit-client'
import { translate } from '@hcengineering/platform'
import { getMediaDevices, getSelectedSpeakerId, type MediaSession } from '@hcengineering/media'
import { LoveEvents } from '@hcengineering/love'
import { useMedia } from '@hcengineering/media-resources'
import { get, writable } from 'svelte/store'
import { Analytics } from '@hcengineering/analytics'
import { addNotification, NotificationSeverity } from '@hcengineering/ui'
import { getCurrentLanguage } from '@hcengineering/theme'
import LastParticipantNotification from './components/meeting/LastParticipantNotification.svelte'
import love from './plugin'
import { $myPreferences } from './stores'
import { leaveMeeting } from './meetings'

export enum ScreenSharingState {
  Inactive,
  Local,
  Remote
}

export const screenSharingState = writable<ScreenSharingState>(ScreenSharingState.Inactive)
export const lkSessionConnected = writable<boolean>(false)
export const lkReconnected = writable<number>(0)

export const lkIsConnecting = writable<boolean>(false)

const LAST_PARTICIPANT_NOTIFICATION_DELAY_MS = 15 * 1000
const AUTO_DISCONNECT_DELAY_MS = 60 * 1000

export function getLiveKitClient (): LiveKitClient {
  return new LiveKitClient()
}

const defaultCaptureOptions: VideoCaptureOptions = {
  facingMode: 'user',
  resolution: {
    width: 1280,
    height: 720,
    frameRate: 30
  }
}

export class LiveKitClient {
  public readonly liveKitRoom: LKRoom

  public currentMediaSession: MediaSession | undefined = undefined
  private currentSessionSupportsVideo: boolean = false
  private lastParticipantNotificationTimeout: number = -1
  private lastParticipantDisconnectTimeout: number = -1

  constructor () {
    const lkRoom = new LKRoom({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        videoCodec: 'vp9',
        screenShareEncoding: {
          maxBitrate: 15_000_000,
          maxFramerate: 24,
          priority: 'high'
        }
      },
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      },
      audioOutput: {
        deviceId: getSelectedSpeakerId()
      },
      videoCaptureDefaults: defaultCaptureOptions
    })
    lkRoom.on(RoomEvent.Connected, this.onConnected)
    lkRoom.on(RoomEvent.Reconnecting, this.onReconnecting)
    lkRoom.on(RoomEvent.Reconnected, this.onReconnected)
    lkRoom.on(RoomEvent.Disconnected, this.onDisconnected)
    this.liveKitRoom = lkRoom
  }

  async prepareConnection (wsUrl: string, token: string): Promise<void> {
    await this.liveKitRoom.prepareConnection(wsUrl, token)
  }

  async connect (wsURL: string, token: string, withVideo: boolean): Promise<void> {
    console.log('[LiveKitClient.connect] Starting connection', {
      wsURL,
      withVideo,
      currentState: this.liveKitRoom.state
    })

    if (get(lkSessionConnected)) {
      console.log('[LiveKitClient.connect] Already connected => Disconnect', {
        wsURL,
        withVideo,
        currentState: this.liveKitRoom.state
      })
      await this.disconnect()
    }

    lkIsConnecting.set(true)
    this.currentSessionSupportsVideo = withVideo
    const ncEnabled = $myPreferences?.noiseCancellation ?? true
    this.liveKitRoom.options.audioCaptureDefaults = {
      ...this.liveKitRoom.options.audioCaptureDefaults,
      autoGainControl: true,
      echoCancellation: ncEnabled,
      noiseSuppression: ncEnabled
    }
    try {
      const setupMediaSession = async (): Promise<void> => {
        this.currentMediaSession = await useMedia({
          state: {
            camera: this.currentSessionSupportsVideo ? { enabled: $myPreferences?.camEnabled ?? true } : undefined,
            microphone: { enabled: $myPreferences?.micEnabled ?? this.liveKitRoom.remoteParticipants.size < 16 }
          },
          autoDestroy: false
        })
      }
      await Promise.all([
        this.liveKitRoom.connect(wsURL, token, {
          maxRetries: 1,
          websocketTimeout: 10000,
          peerConnectionTimeout: 10000
        }),
        setupMediaSession()
      ])

      this.currentMediaSession?.on('camera', (enabled) => {
        void this.setCameraEnabled(enabled)
      })
      this.currentMediaSession?.on('microphone', (enabled) => {
        void this.setMicrophoneEnabled(enabled)
      })
      this.currentMediaSession?.on('selected-camera', (deviceId) => {
        void this.setActiveCamera(deviceId)
      })
      this.currentMediaSession?.on('selected-microphone', (deviceId) => {
        void this.setActiveMicrophone(deviceId)
      })
      this.currentMediaSession?.on('selected-speaker', (deviceId) => {
        void this.setActiveSpeaker(deviceId)
      })
      this.currentMediaSession?.on('feature', (feature, enabled) => {
        if (feature !== 'sharing') return
        void this.setScreenShareEnabled(enabled, true)
      })

      await this.updateActiveDevices()
      console.log('[LiveKitClient.connect] Connection established successfully', { state: this.liveKitRoom.state })
    } catch (error) {
      console.error('[LiveKitClient.connect] Connection failed', { error, state: this.liveKitRoom.state })
      lkIsConnecting.set(false)
      this.currentMediaSession?.close()
      this.currentMediaSession?.removeAllListeners()
      this.currentMediaSession = undefined
      throw error
    }
  }

  async disconnect (): Promise<void> {
    console.log('[LiveKitClient.disconnect] Disconnecting...', { state: this.liveKitRoom.state })
    screenSharingState.set(ScreenSharingState.Inactive)
    clearTimeout(this.lastParticipantNotificationTimeout)
    const me = this.liveKitRoom.localParticipant
    await Promise.all([me.setScreenShareEnabled(false), me.setCameraEnabled(false), me.setMicrophoneEnabled(false)])
    await this.liveKitRoom.disconnect()
    this.currentSessionSupportsVideo = false
    this.currentMediaSession?.close()
    this.currentMediaSession?.removeAllListeners()
    this.currentMediaSession = undefined
    console.log('[LiveKitClient.disconnect] Disconnected', { state: this.liveKitRoom.state })
  }

  async awaitConnect (): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.liveKitRoom.state === ConnectionState.Connected) {
        resolve()
      }
      this.liveKitRoom.once(RoomEvent.Connected, () => {
        resolve()
      })
    })
  }

  onConnected = (): void => {
    console.log('[LiveKitClient.onConnected] Connected event fired')
    lkSessionConnected.set(true)
    lkIsConnecting.set(false)

    this.liveKitRoom.on(RoomEvent.ParticipantConnected, this.onParticipantConnected)
    this.liveKitRoom.on(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected)
    this.liveKitRoom.on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
    this.liveKitRoom.on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
    this.liveKitRoom.on(RoomEvent.LocalTrackPublished, this.onLocalTrackPublished)
    this.liveKitRoom.on(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished)
    this.liveKitRoom.on(RoomEvent.TrackMuted, this.onTrackMuted)
    this.liveKitRoom.on(RoomEvent.TrackUnmuted, this.onTrackUnmuted)
  }

  onReconnecting = (): void => {
    console.log('[LiveKitClient.onReconnecting] Reconnecting event fired')
  }

  onReconnected = (): void => {
    console.log('[LiveKitClient.onReconnected] Reconnected event fired')
    // Signal WorkbenchExtension to re-attach audio elements after reconnect
    lkReconnected.update((v) => v + 1)
  }

  onDisconnected = (): void => {
    console.log('[LiveKitClient.onDisconnected] Disconnected event fired')
    lkSessionConnected.set(false)
    lkIsConnecting.set(false)
    this.liveKitRoom.off(RoomEvent.ParticipantConnected, this.onParticipantConnected)
    this.liveKitRoom.off(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected)
    this.liveKitRoom.off(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
    this.liveKitRoom.off(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
    this.liveKitRoom.off(RoomEvent.LocalTrackPublished, this.onLocalTrackPublished)
    this.liveKitRoom.off(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished)
    this.liveKitRoom.off(RoomEvent.TrackMuted, this.onTrackMuted)
    this.liveKitRoom.off(RoomEvent.TrackUnmuted, this.onTrackUnmuted)
    Analytics.handleEvent(LoveEvents.DisconnectedFromRoom)
  }

  onParticipantConnected = (participant: RemoteParticipant): void => {
    console.log('[LiveKitClient.onParticipantConnected] Participant connected', {
      participantId: participant.identity,
      participantName: participant.name,
      participantKind: participant.kind,
      trackPublicationsCount: participant.trackPublications.size
    })

    // Log participant's audio tracks
    participant.trackPublications.forEach((publication) => {
      if (publication.track?.kind === Track.Kind.Audio) {
        console.log('[LiveKitClient.onParticipantConnected] Participant audio track', {
          participantId: participant.identity,
          trackSid: publication.trackSid,
          isMuted: publication.isMuted,
          isSubscribed: publication.isSubscribed
        })
      }
    })

    // Filter out agents/bots (kind === 4 is agent)
    const humanParticipants = Array.from(this.liveKitRoom.remoteParticipants.values()).filter(
      (p) => p.kind !== 4 && p.permissions?.agent !== true
    )
    if (humanParticipants.length > 0) {
      // Have other remote participants, not just me
      clearTimeout(this.lastParticipantDisconnectTimeout)
      clearTimeout(this.lastParticipantNotificationTimeout)
    }
  }

  onParticipantDisconnected = (participant: RemoteParticipant): void => {
    console.log('[LiveKitClient.onParticipantDisconnected] Participant disconnected', {
      participantId: participant.identity,
      participantName: participant.name,
      participantKind: participant.kind
    })

    // Filter out agents/bots (kind === 4 is agent)
    const humanParticipants = Array.from(this.liveKitRoom.remoteParticipants.values()).filter(
      (p) => p.kind !== 4 && p.permissions?.agent !== true
    )
    if (humanParticipants.length === 0) {
      clearTimeout(this.lastParticipantDisconnectTimeout)
      clearTimeout(this.lastParticipantNotificationTimeout)
      this.lastParticipantNotificationTimeout = window.setTimeout(() => {
        void this.showLastParticipantNotification()
      }, LAST_PARTICIPANT_NOTIFICATION_DELAY_MS)
    }
  }

  onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void => {
    console.log('[LiveKitClient.onTrackSubscribed] Track subscribed', {
      trackSid: publication.trackSid,
      trackKind: track.kind,
      trackSource: track.source,
      participantId: participant.identity,
      participantName: participant.name,
      isMuted: track.isMuted,
      mediaStreamTrackReadyState: track.mediaStreamTrack?.readyState,
      mediaStreamTrackMuted: track.mediaStreamTrack?.muted
    })

    if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
      screenSharingState.set(ScreenSharingState.Remote)
    }

    if (track.kind === Track.Kind.Audio) {
      console.log('[LiveKitClient.onTrackSubscribed] Audio track details', {
        trackSid: publication.trackSid,
        participantId: participant.identity,
        audioLevel: (participant as any).audioLevel,
        isSpeaking: (participant as any).isSpeaking
      })
    }
  }

  onTrackUnsubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void => {
    console.log('[LiveKitClient.onTrackUnsubscribed] Track unsubscribed', {
      trackSid: publication.trackSid,
      trackKind: track.kind,
      participantId: participant.identity,
      participantName: participant.name
    })

    if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
      screenSharingState.set(ScreenSharingState.Inactive)
    }
  }

  onLocalTrackPublished = (publication: LocalTrackPublication, participant: LocalParticipant): void => {
    console.log('[LiveKitClient.onLocalTrackPublished] Local track published', {
      trackSid: publication.trackSid,
      trackKind: publication.track?.kind,
      trackSource: publication.track?.source,
      participantId: participant.identity,
      isMuted: publication.isMuted
    })

    const session = this.currentMediaSession
    const track = publication.track?.mediaStreamTrack
    const deviceId = track?.getSettings().deviceId
    if (publication.track?.kind === Track.Kind.Video) {
      if (publication.track.source === Track.Source.ScreenShare) {
        session?.setFeature('sharing', { enabled: true, track, deviceId })
        screenSharingState.set(ScreenSharingState.Local)
      } else {
        session?.setCamera({ enabled: true, track, deviceId })
      }
    } else if (publication.track?.kind === Track.Kind.Audio) {
      session?.setMicrophone({ enabled: true, track, deviceId })
      console.log('[LiveKitClient.onLocalTrackPublished] Local microphone enabled', {
        trackSid: publication.trackSid,
        deviceId,
        trackSettings: track?.getSettings()
      })
    }
  }

  onLocalTrackUnpublished = (publication: LocalTrackPublication, participant: LocalParticipant): void => {
    console.log('[LiveKitClient.onLocalTrackUnpublished] Local track unpublished', {
      trackSid: publication.trackSid,
      trackKind: publication.track?.kind,
      trackSource: publication.track?.source,
      participantId: participant.identity
    })

    const session = this.currentMediaSession
    if (publication.track?.kind === Track.Kind.Video) {
      if (publication.track.source === Track.Source.ScreenShare) {
        session?.setFeature('sharing', { enabled: false })
        screenSharingState.set(ScreenSharingState.Inactive)
      } else {
        session?.setCamera({ enabled: false })
      }
    } else if (publication.track?.kind === Track.Kind.Audio) {
      session?.setMicrophone({ enabled: false })
      console.log('[LiveKitClient.onLocalTrackUnpublished] Local microphone disabled', {
        trackSid: publication.trackSid
      })
    }
  }

  onTrackMuted = (publication: TrackPublication, participant: Participant): void => {
    console.log('[LiveKitClient.onTrackMuted] Track muted', {
      trackSid: publication.trackSid,
      trackKind: publication.track?.kind,
      participantId: participant.identity,
      isLocal: participant.isLocal
    })

    if (!participant.isLocal) return
    const session = this.currentMediaSession
    if (publication.track?.kind === Track.Kind.Video && publication.track.source === Track.Source.Camera) {
      session?.setCamera({ enabled: false })
    } else if (publication.track?.kind === Track.Kind.Audio) {
      session?.setMicrophone({ enabled: false })
      console.log('[LiveKitClient.onTrackMuted] Local microphone muted', {
        trackSid: publication.trackSid
      })
    }
  }

  onTrackUnmuted = (publication: TrackPublication, participant: Participant): void => {
    console.log('[LiveKitClient.onTrackUnmuted] Track unmuted', {
      trackSid: publication.trackSid,
      trackKind: publication.track?.kind,
      participantId: participant.identity,
      isLocal: participant.isLocal
    })

    if (!participant.isLocal) return
    const session = this.currentMediaSession
    const track = publication.track?.mediaStreamTrack
    const deviceId = track?.getSettings().deviceId
    if (publication.track?.kind === Track.Kind.Video && publication.track?.source === Track.Source.Camera) {
      session?.setCamera({ enabled: true, track, deviceId })
    } else if (publication.track?.kind === Track.Kind.Audio) {
      session?.setMicrophone({ enabled: true, track, deviceId })
      console.log('[LiveKitClient.onTrackUnmuted] Local microphone unmuted', {
        trackSid: publication.trackSid,
        deviceId,
        trackSettings: track?.getSettings()
      })
    }
  }

  async showLastParticipantNotification (): Promise<void> {
    addNotification(
      await translate(love.string.MeetingEmptyTitle, {}, getCurrentLanguage()),
      await translate(love.string.MeetingEmptyMessage, {}, getCurrentLanguage()),
      LastParticipantNotification,
      {
        onRemove: () => {
          clearTimeout(this.lastParticipantDisconnectTimeout)
          this.lastParticipantDisconnectTimeout = -1
        }
      },
      NotificationSeverity.Info,
      'love'
    )
    this.lastParticipantDisconnectTimeout = window.setTimeout(() => {
      void leaveMeeting()
    }, AUTO_DISCONNECT_DELAY_MS)
  }

  async updateActiveDevices (): Promise<void> {
    await this.setActiveCamera(this.currentMediaSession?.state.camera?.deviceId)
    await this.setActiveMicrophone(this.currentMediaSession?.state.microphone?.deviceId)
    await this.setCameraEnabled(this.currentMediaSession?.state.camera?.enabled ?? false)
    await this.setMicrophoneEnabled(this.currentMediaSession?.state.microphone?.enabled ?? false)
  }

  async setActiveCamera (deviceId: string | undefined): Promise<void> {
    if (deviceId === undefined || deviceId === null) return
    if (!this.currentSessionSupportsVideo) return
    await this.liveKitRoom.switchActiveDevice('videoinput', deviceId, true)
  }

  async setActiveMicrophone (deviceId: string | undefined): Promise<void> {
    if (deviceId === undefined || deviceId === null) return
    await this.liveKitRoom.switchActiveDevice('audioinput', deviceId, true)
  }

  async setActiveSpeaker (deviceId: string | undefined): Promise<void> {
    if (deviceId === undefined || deviceId === null) return
    try {
      await this.liveKitRoom.switchActiveDevice('audiooutput', deviceId, true)
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * Enable or disable the local camera.
   *
   * NOTE: allow enabling camera even if the session was originally created
   * without video support (for example when user chose to join muted/no-video).
   * When enabling later we mark the session as supporting video and initialize
   * the local media session camera state so enabling works properly.
   */
  async setCameraEnabled (value: boolean): Promise<void> {
    // If trying to disable and session didn't support video originally, nothing to do.
    if (!value && !this.currentSessionSupportsVideo) return

    // If enabling and session originally didn't support video, mark it supported
    // and make sure media session has a camera state so downstream logic works.
    if (value && !this.currentSessionSupportsVideo) {
      this.currentSessionSupportsVideo = true
      try {
        // Initialize camera state inside current media session if present.
        this.currentMediaSession?.setCamera({ enabled: true })
      } catch (err) {
        // Best-effort: ignore errors during media session update
        console.debug('[LiveKitClient.setCameraEnabled] failed to initialize media session camera state', err)
      }
    }

    try {
      await this.liveKitRoom.localParticipant.setCameraEnabled(value)
    } catch (e) {
      // If enabling failed, try to select an available camera and enable again.
      if (value) {
        const mediaDevices = await getMediaDevices(false, true)
        if (mediaDevices.activeCamera !== undefined) {
          await this.setActiveCamera(mediaDevices.activeCamera.deviceId)
          await this.liveKitRoom.localParticipant.setCameraEnabled(true)
        }
      }
    }
  }

  async applyNoiseCancellation (value: boolean): Promise<void> {
    this.liveKitRoom.options.audioCaptureDefaults = {
      ...this.liveKitRoom.options.audioCaptureDefaults,
      autoGainControl: true,
      echoCancellation: value,
      noiseSuppression: value
    }
    // Restart mic track so new capture constraints take effect mid-call.
    const me = this.liveKitRoom.localParticipant
    const micPub = me.getTrackPublication(Track.Source.Microphone)
    if (micPub !== undefined && !micPub.isMuted) {
      try {
        await me.setMicrophoneEnabled(false)
        await me.setMicrophoneEnabled(true)
      } catch (e) {
        console.error('[LiveKitClient.applyNoiseCancellation] failed to restart mic', e)
      }
    }
  }

  async setMicrophoneEnabled (value: boolean): Promise<void> {
    try {
      await this.liveKitRoom.localParticipant.setMicrophoneEnabled(value)
    } catch (e) {
      if (value) {
        const mediaDevices = await getMediaDevices(true, false)
        if (mediaDevices.activeMicrophone !== undefined) {
          await this.setActiveMicrophone(mediaDevices.activeMicrophone.deviceId)
          await this.liveKitRoom.localParticipant.setMicrophoneEnabled(true)
        }
      }
    }
  }

  async setScreenShareEnabled (value: boolean, withAudio: boolean = false): Promise<void> {
    try {
      await this.liveKitRoom.localParticipant.setScreenShareEnabled(value, { audio: withAudio })
    } catch (e) {
      console.log(e)
    }
  }
}
