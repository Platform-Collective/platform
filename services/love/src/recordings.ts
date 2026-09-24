import { WorkspaceLoginInfo } from '@hcengineering/account-client'
import { MeasureContext, Ref, WorkspaceIds, WorkspaceUuid } from '@hcengineering/core'
import { MeetingMinutes, queueEvents, QueueMeetingMessage, RecordingFormat, RecordingState } from '@hcengineering/love'
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  S3Upload,
  WebhookConfig
} from 'livekit-server-sdk'
import { WorkspaceClient } from './workspaceClient'
import { PlatformQueueProducer, StorageConfig } from '@hcengineering/server-core'
import { getS3UploadParams } from './storage'
import { getRecordingPreset } from './preset'
import config from './config'

export class RecordingProcessor {
  constructor (
    readonly ctx: MeasureContext,
    readonly roomClient: RoomServiceClient,
    readonly eventProducer: PlatformQueueProducer<QueueMeetingMessage>,
    readonly egressClient: EgressClient,
    readonly storageConfig: StorageConfig | undefined,
    readonly s3storageConfig: StorageConfig | undefined
  ) {}

  async startRecording (
    roomName: string,
    workspaceId: WorkspaceUuid,
    meetingId: Ref<MeetingMinutes>,
    wsLoginInfo: WorkspaceLoginInfo,
    meetingTitle: string
  ): Promise<void> {
    // Check if LiveKit room exists before starting recording
    const existingRooms = await this.roomClient.listRooms([roomName])
    if (existingRooms === undefined || existingRooms.length === 0) {
      this.ctx.warn('Cannot start recording: LiveKit room does not exist', { roomName })
      return
    }

    const dateStr = new Date().toISOString().replace('T', '_').slice(0, 19)
    // Use MeetingMinutes title for recording filename

    const wsClient = await WorkspaceClient.create(wsLoginInfo.workspace, this.ctx)
    try {
      const meetingDoc = await wsClient.findMeetingById(meetingId)
      if (meetingDoc === undefined) {
        this.ctx.error('Meeting document not found when starting recording', { meetingId })
        throw new Error('Meeting not found')
      }

      // Check if there's already an active video recording for this meeting
      const existingRecordings = await wsClient.findPendingRecordingsByMeeting(meetingId)
      const activeVideoRecording = existingRecordings.find(
        (r) => r.format === 'video' && (r.status === 'active' || r.status === 'completed' || r.status == null)
      )
      if (activeVideoRecording !== undefined) {
        this.ctx.warn('Video recording already in progress for this meeting', {
          meetingId,
          existingEgressId: activeVideoRecording.egressId,
          status: activeVideoRecording.status
        })
        return
      }

      meetingTitle = meetingTitle.replace(/[^a-zA-Z0-9_-]/g, '_')

      const name = `${meetingTitle}_${dateStr}.mp4`
      const wsIds = {
        uuid: wsLoginInfo.workspace,
        dataId: wsLoginInfo.workspaceDataId,
        url: wsLoginInfo.workspaceUrl
      }
      const { egressId } = await this.startRecord(this.ctx, roomName, wsIds, meetingId)

      await wsClient.createPendingRecording({
        meeting: meetingId,
        format: 'video',
        roomName,
        name,
        egressId
      })
      // Update meeting document to reflect recording started
      await wsClient.updateMeetingRecordingState(meetingDoc, RecordingState.Recording)
    } catch (err: any) {
      this.ctx.error('Failed to start recording', { error: err?.message ?? String(err), meetingId, roomName })
      throw err
    }

    this.ctx.info('Start recording', { workspace: wsLoginInfo.workspace, roomName, meetingId })
  }

  async stopRecording (roomName: string, workspaceId: WorkspaceUuid, meetingId: Ref<MeetingMinutes>): Promise<void> {
    this.ctx.info('[stopRecording] Called', { roomName, meetingId, workspace: workspaceId })

    // Check if LiveKit room exists before stopping recording
    const existingRooms = await this.roomClient.listRooms([roomName])
    if (existingRooms === undefined || existingRooms.length === 0) {
      this.ctx.warn('[stopRecording] LiveKit room does not exist, skipping stop', { roomName, meetingId })
      return
    }

    this.ctx.info('[stopRecording] Room found, stopping video recording', { roomName, meetingId })
    await this.stopRecordingByKind(roomName, workspaceId, meetingId, 'video')
    await this.eventProducer.send(this.ctx, workspaceId, [
      queueEvents.updateMetadata(meetingId, roomName, { recording: false })
    ])
  }

  async startAudioRecording (
    roomName: string,
    workspaceId: WorkspaceUuid,
    meetingId: Ref<MeetingMinutes>,
    wsLoginInfo: WorkspaceLoginInfo
  ): Promise<void> {
    // Check if LiveKit room exists before starting audio recording
    const existingRooms = await this.roomClient.listRooms([roomName])
    if (existingRooms === undefined || existingRooms.length === 0) {
      this.ctx.warn('Cannot start audio recording: LiveKit room does not exist', { roomName })
      return
    }

    if (this.storageConfig === undefined) {
      this.ctx.error('Cannot start audio recording: no storage configuration')
      return
    }

    const wsClient = await WorkspaceClient.create(wsLoginInfo.workspace, this.ctx)
    try {
      const meetingDoc = await wsClient.findMeetingById(meetingId)
      if (meetingDoc === undefined) {
        this.ctx.error('Meeting document not found when starting audio recording', { meetingId })
        return
      }

      const wsIds = {
        uuid: wsLoginInfo.workspace,
        dataId: wsLoginInfo.workspaceDataId,
        url: wsLoginInfo.workspaceUrl
      }
      const uploadParams = await getS3UploadParams(this.ctx, wsIds, this.storageConfig, this.s3storageConfig)
      const { filepath, endpoint, accessKey, secret, region, bucket } = uploadParams

      // Replace .mp4 extension with .ogg for audio
      const audioFilepath = filepath.replace(/\.mp4$/, '.ogg')

      this.ctx.info('Starting audio recording', { audioFilepath, endpoint, region, bucket, roomName })

      const output = new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: audioFilepath,
        disableManifest: true,
        output: {
          case: 's3',
          value: new S3Upload({
            endpoint,
            accessKey,
            region,
            secret,
            bucket,
            forcePathStyle: true
          })
        }
      })

      const { egressId } = await this.egressClient.startRoomCompositeEgress(
        roomName,
        { file: output },
        {
          audioOnly: true,
          webhooks:
            config.UseEgressWebHook && config.WebHookUrl !== ''
              ? [
                  new WebhookConfig({
                    url: config.WebHookUrl,
                    signingKey: config.ApiKey
                  })
                ]
              : []
        }
      )

      const dateStr = new Date().toISOString().replace('T', '_').slice(0, 19)
      const meetingTitle = meetingDoc.title.replace(/[^a-zA-Z0-9_-]/g, '_')
      const name = `${meetingTitle}_${dateStr}.ogg`

      await wsClient.createPendingRecording({
        meeting: meetingId,
        format: 'audio',
        roomName,
        name,
        egressId
      })

      this.ctx.info('Audio recording started', { workspace: workspaceId, roomName, meetingId, egressId })
    } catch (err: any) {
      this.ctx.error('Failed to start audio recording', {
        error: err?.message ?? String(err),
        meetingId,
        roomName
      })
    }
  }

  async stopAudioRecording (
    roomName: string,
    workspaceId: WorkspaceUuid,
    meetingId: Ref<MeetingMinutes>
  ): Promise<void> {
    await this.stopRecordingByKind(roomName, workspaceId, meetingId, 'audio')
  }

  async stopRecordingByKind (
    roomName: string,
    workspaceId: WorkspaceUuid,
    meetingId: Ref<MeetingMinutes>,
    kind: RecordingFormat
  ): Promise<void> {
    const wsClient = await WorkspaceClient.create(workspaceId, this.ctx)
    try {
      // Find audio PendingRecording for this meeting
      const pendingRecordings = await wsClient.findPendingRecordingsByMeeting(meetingId)
      const kindPending = pendingRecordings.filter((r) => r.format === kind)

      for (const pending of kindPending) {
        // Mark as cancelled immediately so UI can show loading state
        await wsClient.cancelPendingRecording(pending)

        if (pending.egressId !== undefined) {
          try {
            await this.egressClient.stopEgress(pending.egressId)
            this.ctx.info(kind + ' recording stopping send', { egressId: pending.egressId })
          } catch (err: any) {
            const errorMsg = err?.message ?? String(err)
            // Egress might already be stopped or completed - this is not an error
            if (
              (typeof errorMsg === 'string' && errorMsg?.includes('EGRESS_COMPLETE')) ||
              (typeof errorMsg === 'string' && errorMsg?.includes('EGRESS_ABORTED')) ||
              (typeof errorMsg === 'string' && errorMsg?.includes('cannot be stopped'))
            ) {
              this.ctx.info(kind + ' recording already stopped or completed', {
                egressId: pending.egressId,
                reason: errorMsg
              })
            } else {
              this.ctx.error('Failed to stop ' + kind + ' egress', {
                error: errorMsg,
                egressId: pending.egressId
              })
            }
          }
        }
      }
    } catch (err: any) {
      this.ctx.error(`Failed to stop ${kind} recording`, {
        error: err?.message ?? String(err),
        meetingId,
        roomName
      })
    }
  }

  private async startRecord (
    ctx: MeasureContext,
    roomName: string,
    wsIds: WorkspaceIds,
    meetingId: Ref<MeetingMinutes>
  ): Promise<{ filepath: string, egressId: string }> {
    if (this.storageConfig === undefined) {
      console.error('please provide storage configuration')
      throw new Error('please provide storage configuration')
    }
    const uploadParams = await getS3UploadParams(ctx, wsIds, this.storageConfig, this.s3storageConfig)

    const { filepath, endpoint, accessKey, secret, region, bucket } = uploadParams

    ctx.info('staring recording on', { filepath, endpoint, region, bucket })
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      disableManifest: true,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint,
          accessKey,
          region,
          secret,
          bucket,
          forcePathStyle: true
        })
      }
    })
    const { preset } = getRecordingPreset(config.RecordingPreset)

    const { egressId } = await this.egressClient.startRoomCompositeEgress(
      roomName,
      { file: output },
      {
        layout: 'grid',
        encodingOptions: preset,
        webhooks:
          config.UseEgressWebHook && config.WebHookUrl !== ''
            ? [
                new WebhookConfig({
                  url: config.WebHookUrl,
                  signingKey: config.ApiKey
                })
              ]
            : []
      }
    )
    await this.eventProducer.send(this.ctx, wsIds.uuid, [
      queueEvents.updateMetadata(meetingId, roomName, { recording: true })
    ])
    return { filepath, egressId }
  }
}
