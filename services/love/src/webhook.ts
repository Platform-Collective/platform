import { MeasureContext, Ref, WorkspaceIds, type WorkspaceUuid } from '@hcengineering/core'
import love, {
  MeetingMinutes,
  queueEvents,
  QueueMeetingMessage,
  RecordingState,
  type ParsedRoomName
} from '@hcengineering/love'

import { Person } from '@hcengineering/contact'
import { PlatformQueueProducer, StorageConfig } from '@hcengineering/server-core'
import {
  EgressClient,
  ParticipantInfo as LKParticipantInfo,
  RoomServiceClient,
  type WebhookEvent
} from 'livekit-server-sdk'
import { saveLiveKitEgressBilling } from './billing'
import config from './config'
import { getRecordingPreset } from './preset'
import { saveFile } from './storage'
import { WorkspaceClient } from './workspaceClient'
import platform, { PlatformError } from '@hcengineering/platform'
import { parseParticipantMetadata } from './utils'

export class WebhookProcessor {
  constructor (
    readonly ctx: MeasureContext,
    readonly roomClient: RoomServiceClient,
    readonly eventProducer: PlatformQueueProducer<QueueMeetingMessage>,
    readonly egressClient: EgressClient,
    readonly storageConfig: StorageConfig | undefined,
    readonly s3storageConfig: StorageConfig | undefined
  ) {}

  async processEvent (event: WebhookEvent, roomName: ParsedRoomName): Promise<void> {
    const { workspace, meetingId } = roomName

    // Handle egress_started - log only, PendingRecording is created in /startRecord
    if (event.event === 'egress_started') {
      await this.egressStarted(event, roomName)
      return
    }

    // Handle egress_updated - update size in PendingRecording if available
    if (event.event === 'egress_updated') {
      await this.egressUpdated(event, roomName)
      return
    }

    // Handle egress (recording finished) - save file and remove PendingRecording
    if (event.event === 'egress_ended') {
      await this.egressEnded(event, roomName)
      return
    }

    try {
      const wsClient = await WorkspaceClient.create(workspace, this.ctx)
      // Participant joined / left -> manage ParticipantInfo and PendingJoin via LiveKit events only
      if (event.event === 'participant_joined' || event.event === 'participant_left') {
        await this.handleJoinLeave(event, roomName, wsClient)
        return
      }

      // Room finished -> mark meeting finished and add activity
      if (event.event === 'room_finished') {
        await this.roomFinished(event, meetingId, wsClient, workspace, roomName)
        return
      }

      // Room started -> optionally add an activity entry
      if (event.event === 'room_started') {
        // When a room starts, mark the associated MeetingMinutes as Active.
        await this.roomStarted(meetingId, wsClient, workspace, roomName)
        return
      }
    } catch (err: any) {
      const wsNotFound = err instanceof PlatformError && err.status.code === platform.status.WorkspaceNotFound

      if (!wsNotFound) {
        this.ctx.error('Failed to process livekit event', { error: err?.message ?? String(err), event: event.event })
      }
      return
    }

    // Unknown event type - acknowledge receipt but don't process
    this.ctx.info('Ignoring unhandled webhook event type', { event: event.event })
  }

  private async handleJoinLeave (
    event: WebhookEvent,
    roomName: ParsedRoomName,
    wsClient: WorkspaceClient
  ): Promise<void> {
    const { workspace, meetingId } = roomName
    if (event.participant === undefined) {
      this.ctx.info('[Webhook] Skipping participant event: no participant info', {
        event: event.event,
        meetingId,
        workspace
      })
      return
    }
    const participant: LKParticipantInfo = event.participant
    this.ctx.info('[Webhook] Processing participant event', {
      event: event.event,
      identity: participant.identity,
      name: participant.name,
      meetingId,
      workspace
    })
    const displayName = participant.name ?? participant.identity ?? 'Unknown'
    const props = {
      identity: participant.identity,
      name: participant.name,
      joinedAt: participant.joinedAt ?? participant.joinedAtMs ?? null,
      disconnectReason: participant.disconnectReason ?? null
    }

    // Only handle rooms that use MeetingMinutes ID (workspace_..._meetingMinutesId)
    if (meetingId === undefined) {
      this.ctx.info('[Webhook] Skipping participant event: not a MeetingMinutes-identified room', {
        workspace,
        meetingId
      })
      return
    }

    // Resolve the MeetingMinutes -> attached room so we can create/remove ParticipantInfo there
    const meetingDoc = await wsClient.findMeetingById(meetingId)
    this.ctx.info('[Webhook] Found meetingDoc', {
      meetingId,
      meetingDocFound: meetingDoc !== undefined,
      attachedTo: meetingDoc?.attachedTo,
      identity: participant.identity
    })
    const attachedRoom = meetingDoc?.attachedTo
    if (attachedRoom === undefined) {
      this.ctx.info('[Webhook] Skipping participant event: MeetingMinutes missing attached room', {
        workspace,
        meetingId,
        identity: participant.identity
      })
      return
    }

    // Try to resolve Person by LiveKit identity (identity expected to be Person._id as tokens set identity = person._id)
    const personRef = await wsClient.findPersonRefById(participant.identity as Ref<Person>)
    this.ctx.info('[Webhook] Resolved personRef', {
      identity: participant.identity,
      personRef,
      meetingId
    })
    if (personRef === undefined) {
      this.ctx.info('[Webhook] participant identity could not be resolved to Person', {
        identity: participant.identity,
        meetingId
      })
      return
    }

    // Skip activity logs only for agent/system participants.
    // If personRef is known (even without SocialIdentity), we still add activity entries
    // so joins/leaves from real Person records are visible in MeetingMinutes.
    const isAgent = participant?.kind !== 0

    if (!isAgent) {
      if (event.event === 'participant_joined') {
        await this.handleParticipantJoined(personRef, participant, roomName, wsClient)
      } else {
        // participant_left -> remove any ParticipantInfo records for this person or by name as fallback
        // Skip only for truly unknown identities
        await this.handleParticipantLeft(wsClient, personRef, participant, roomName)
      }
    }

    // Add activity entry to MeetingMinutes for visibility (from participant's identity)
    // Skip for recorder participants, agents, and unknown identities to avoid logging system events as participant joins
    if (!isAgent) {
      // Get PersonId for the participant to use as modifiedBy (optional)
      const participantPersonId = await wsClient.getPersonIdByPersonRef(personRef, displayName)

      await wsClient.addActivityToMeeting(
        event.event === 'participant_joined' ? love.string.JoinedMeeting : love.string.LeaveParticipant,
        meetingId,
        { props, name: displayName },
        undefined, // icon
        participantPersonId // modifiedBy - use participant's PersonId
      )
    }
  }

  private async handleParticipantLeft (
    wsClient: WorkspaceClient,
    personRef: Ref<Person>,
    participant: LKParticipantInfo,
    roomName: ParsedRoomName
  ): Promise<void> {
    if (!(personRef === undefined)) {
      await wsClient.removeParticipantFromLiveKit(roomName.meetingId, personRef, participant.sid)
      await this.eventProducer.send(this.ctx, roomName.workspace, [
        queueEvents.personJoined(roomName.meetingId, personRef, participant.identity ?? '')
      ])
    }
  }

  private async handleParticipantJoined (
    personRef: Ref<Person>,
    participant: LKParticipantInfo,
    roomName: ParsedRoomName,
    wsClient: WorkspaceClient
  ): Promise<void> {
    this.ctx.info('[Webhook] participant_joined - will upsert?', {
      personRef,
      identity: participant.identity,
      meetingId: roomName.meetingId
    })
    const participantMetadata = parseParticipantMetadata(participant.metadata)
    await wsClient.upsertParticipantFromLiveKit(
      personRef,
      participant.name ?? participant.identity ?? 'Unknown',
      null,
      roomName.meetingId,
      participant.sid,
      participantMetadata
    )
    await this.eventProducer.send(this.ctx, roomName.workspace, [
      queueEvents.personJoined(roomName.meetingId, personRef, participant.identity ?? '')
    ])
  }

  private async roomStarted (
    meetingId: Ref<MeetingMinutes>,
    wsClient: WorkspaceClient,
    workspace: WorkspaceUuid,
    roomName: ParsedRoomName
  ): Promise<void> {
    if (meetingId !== undefined) {
      await wsClient.activateMeeting(meetingId)
      await this.eventProducer.send(this.ctx, roomName.workspace, [queueEvents.started(roomName.meetingId)])
    } else {
      this.ctx.info('Skipping room_started: not a MeetingMinutes-identified room', { workspace, roomName })
    }
  }

  private async roomFinished (
    event: WebhookEvent,
    meetingId: Ref<MeetingMinutes>,
    wsClient: WorkspaceClient,
    workspace: WorkspaceUuid,
    roomName: ParsedRoomName
  ): Promise<void> {
    const meetingEnd =
      typeof event.createdAt === 'string' || typeof event.createdAt === 'number'
        ? Number(event.createdAt) * 1000
        : Date.now()

    if (meetingId !== undefined) {
      await wsClient.finishMeeting(meetingId, meetingEnd)

      await this.eventProducer.send(this.ctx, roomName.workspace, [queueEvents.finished(roomName.meetingId)])
    } else {
      this.ctx.info('Skipping room_finished: not a MeetingMinutes-identified room', { workspace, roomName })
      // Do not operate on legacy room-id-only events.
    }
  }

  private async egressUpdated (event: WebhookEvent, roomName: ParsedRoomName): Promise<void> {
    if (event.egressInfo === undefined) {
      return
    }
    const egressId = event.egressInfo.egressId

    // Try to get size from file results
    const egressInfo = event.egressInfo
    const fileResults = egressInfo.fileResults ?? []
    for (const fileResult of fileResults) {
      if (fileResult.size !== undefined && fileResult.size > 0) {
        try {
          const wsClient = await WorkspaceClient.create(roomName.workspace, this.ctx)
          await wsClient.updatePendingRecordingSize(egressId, Number(fileResult.size))

          await this.eventProducer.send(this.ctx, roomName.workspace, [
            queueEvents.egressEvent(roomName.meetingId, event.egressInfo.egressId, 'updated', {
              ended: event.egressInfo.endedAt,
              fileName: fileResult.filename,
              size: Number(fileResult.size)
            })
          ])
        } catch (err: any) {
          this.ctx.error('egress_updated: failed to update size', {
            error: err?.message ?? String(err),
            egressId
          })
        }
      }
    }
  }

  private async egressEnded (event: WebhookEvent, roomName: ParsedRoomName): Promise<void> {
    if (event.egressInfo === undefined) {
      return
    }
    const egressId = event.egressInfo.egressId

    this.ctx.info('egress_ended received', { egressId, roomName })

    try {
      const wsClient = await WorkspaceClient.create(roomName.workspace, this.ctx)
      const wsIds: WorkspaceIds = {
        uuid: roomName.workspace,
        url: ''
      }
      const meeting = await wsClient.findMeetingById(roomName.meetingId)
      if (meeting === undefined) {
        this.ctx.warn('egress_ended: meeting not found', { egressId, meetingId: roomName.meetingId })
        return
      }

      await wsClient.updateMeetingRecordingState(meeting, RecordingState.Finished)

      // Process file results - save to storage and attach to meeting
      for (const fileResult of event.egressInfo.fileResults) {
        this.ctx.info('Processing egress file result', { egressId, filename: fileResult.filename })

        if (this.storageConfig !== undefined) {
          const storedBlob = await saveFile(
            this.ctx,
            wsIds,
            this.storageConfig,
            this.s3storageConfig,
            fileResult.filename
          )
          if (storedBlob !== undefined) {
            this.ctx.info('Stored file', { storedBlob })

            const preset = getRecordingPreset(config.RecordingPreset)
            // Use name from PendingRecording if available, otherwise generate from filename
            const pendingRecording = await wsClient.findPendingRecordingByEgressId(egressId)
            if (pendingRecording !== undefined) {
              const name = pendingRecording.name ?? fileResult.filename.split('/').pop() ?? 'recording.mp4'
              await wsClient.saveFile(storedBlob._id, name, storedBlob, preset, roomName.meetingId)
              await wsClient.removePendingRecording(pendingRecording)

              await this.eventProducer.send(this.ctx, roomName.workspace, [
                queueEvents.egressEvent(roomName.meetingId, event.egressInfo.egressId, 'ended', {
                  ended: event.egressInfo.endedAt,
                  storedBlob,
                  name,
                  preset
                })
              ])
            }
          } else {
            this.ctx.error('Not Stored file', { storedBlob })
          }
        }
      }
    } catch (err: any) {
      this.ctx.error('egress_ended: failed to process recording', {
        error: err?.message ?? String(err),
        egressId
      })
    }

    try {
      await saveLiveKitEgressBilling(this.ctx, event.egressInfo)
    } catch {
      // Ensure we don't fail the webhook if billing fails
    }
  }

  private async egressStarted (event: WebhookEvent, roomName: ParsedRoomName): Promise<void> {
    if (event.egressInfo === undefined) {
      return
    }
    this.ctx.info('egress_started received', {
      egressId: event.egressInfo.egressId,
      roomName
    })
    await this.eventProducer.send(this.ctx, roomName.workspace, [
      queueEvents.egressEvent(roomName.meetingId, event.egressInfo.egressId, 'started', {
        started: event.egressInfo.startedAt
      })
    ])
  }
}
