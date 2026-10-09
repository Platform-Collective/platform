//
// Copyright © 2024 Hardcore Engineering Inc.
// Copyright © 2026 Intabia Fusion
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

import activity, { ActivityInfoMessage } from '@hcengineering/activity'
import { RestClient } from '@hcengineering/api-client'
import attachment, { Attachment } from '@hcengineering/attachment'
import contact, { Person } from '@hcengineering/contact'
import core, {
  Data,
  MeasureContext,
  Ref,
  generateId,
  systemAccountUuid,
  type AccountUuid,
  type Blob,
  type PersonId,
  type WorkspaceUuid,
  DocumentUpdate,
  SocialIdType
} from '@hcengineering/core'
import love, {
  MeetingMinutes,
  MeetingStatus,
  ParticipantInfo,
  ParticipantMetadata,
  PendingRecording,
  RecordingFormat,
  RecordingState,
  Room,
  TranscriptionState,
  getFreeRoomPlace
} from '@hcengineering/love'
import { Asset, IntlString } from '@hcengineering/platform'
import { generateToken } from '@hcengineering/server-token'
import { getClient } from './client'
import { RecordingPreset } from './preset'

export class WorkspaceClient {
  private client!: RestClient

  // Static cache for workspace clients
  private static readonly workspaces = new Map<WorkspaceUuid, WorkspaceClient>()
  private static readonly connectingWorkspaces = new Map<WorkspaceUuid, Promise<void>>()

  private constructor (
    private readonly workspace: WorkspaceUuid,
    private readonly ctx: MeasureContext
  ) {}

  static async create (workspace: WorkspaceUuid, ctx: MeasureContext): Promise<WorkspaceClient> {
    return await WorkspaceClient.getWorkspaceClient(workspace, ctx)
  }

  async close (): Promise<void> {}

  private static async initWorkspaceClient (workspace: WorkspaceUuid, ctx: MeasureContext): Promise<void> {
    if (WorkspaceClient.connectingWorkspaces.has(workspace)) {
      return await WorkspaceClient.connectingWorkspaces.get(workspace)
    }

    const initPromise = (async () => {
      try {
        if (!WorkspaceClient.workspaces.has(workspace)) {
          const instance = new WorkspaceClient(workspace, ctx)
          await instance.initClient(workspace)
          WorkspaceClient.workspaces.set(workspace, instance)
        }
      } catch (err: any) {
        ctx.error('Failed to initialize workspace client', { error: err?.message ?? String(err), workspace })
      } finally {
        WorkspaceClient.connectingWorkspaces.delete(workspace)
      }
    })()

    WorkspaceClient.connectingWorkspaces.set(workspace, initPromise)
    await initPromise
  }

  static async getWorkspaceClient (workspace: WorkspaceUuid, ctx: MeasureContext): Promise<WorkspaceClient> {
    await WorkspaceClient.initWorkspaceClient(workspace, ctx)
    const client = WorkspaceClient.workspaces.get(workspace)
    if (client === undefined) {
      throw new Error(`Failed to get workspace client for ${workspace}`)
    }
    return client
  }

  static async closeAll (): Promise<void> {
    for (const workspace of WorkspaceClient.workspaces.values()) {
      await workspace.close()
    }
    WorkspaceClient.workspaces.clear()
    WorkspaceClient.connectingWorkspaces.clear()
  }

  private async initClient (workspace: WorkspaceUuid): Promise<RestClient> {
    const token = generateToken(systemAccountUuid, workspace, { service: 'love' })
    this.client = await getClient(token, workspace)
    return this.client
  }

  async saveFile (
    uuid: string,
    name: string,
    blob: Blob,
    preset: RecordingPreset,
    meetingMinutes?: Ref<MeetingMinutes>
  ): Promise<void> {
    this.ctx.info('Save recording', { workspace: this.workspace, meetingMinutes })
    // Drive file creation disabled: shared Drive bypasses room privacy ACL. TODO: revisit with per-room ACL support.
    const data = {
      file: uuid as Ref<Blob>,
      size: blob.size,
      type: blob.contentType,
      lastModified: blob.modifiedOn,
      // hardcoded values from preset we use
      // https://docs.livekit.io/realtime/egress/overview/#EncodingOptionsPreset
      metadata: {
        originalHeight: preset.height,
        originalWidth: preset.width
      }
    }
    // await createFile(this.client, love.space.Drive, drive.ids.Root, { ...data, title: name })
    await this.attachToMeetingMinutes({ ...data, name }, meetingMinutes)
  }

  async attachToMeetingMinutes (
    data: Omit<Data<Attachment>, 'attachedToClass' | 'attachedTo' | 'collection'>,
    ref?: Ref<MeetingMinutes>
  ): Promise<void> {
    if (ref === undefined) return

    const meeting = await this.client.findOne(love.class.MeetingMinutes, { _id: ref })
    if (meeting === undefined) {
      this.ctx.error('Meeting not found', { _id: ref })
      return
    }

    await this.client.addCollection(
      attachment.class.Attachment,
      meeting.space,
      meeting._id,
      meeting._class,
      'attachments',
      data
    )
  }

  /**
   * Add an ActivityInfoMessage to a MeetingMinutes document.
   * `message` may be a simple string (will be converted to { en: string }) or an Intl-like object.
   * `modifiedBy` allows specifying the person who performed the action (for participant join/leave).
   */
  async addActivityToMeeting (
    message: IntlString,
    ref: Ref<MeetingMinutes>,
    props?: Record<string, any>,
    icon?: string,
    modifiedBy?: PersonId
  ): Promise<void> {
    if (ref === undefined) return

    const meeting = await this.client.findOne(love.class.MeetingMinutes, { _id: ref })
    if (meeting === undefined) {
      this.ctx.error('Meeting not found', { _id: ref })
      return
    }

    await this.client.addCollection<MeetingMinutes, ActivityInfoMessage>(
      activity.class.ActivityInfoMessage,
      meeting.space,
      meeting._id,
      meeting._class,
      'activity',
      {
        message,
        props: props ?? {},
        icon: icon as Asset
      },
      undefined, // id
      undefined, // modifiedOn
      modifiedBy // modifiedBy - use participant's PersonId
    )
    this.ctx.info('[WorkspaceClient.addActivityToMeeting] Added activity message', { meeting: meeting._id, message })
  }

  /**
   * Activate meeting (set status to Active).
   * No activity message is added - status change is reflected in meeting document.
   */
  async activateMeeting (ref: Ref<MeetingMinutes>): Promise<void> {
    if (ref === undefined) return

    const meeting = await this.client.findOne(love.class.MeetingMinutes, { _id: ref })
    if (meeting === undefined) {
      this.ctx.error('Meeting not found', { _id: ref })
      return
    }

    // Never resurrect a finished meeting. A stale client that reconnected with
    // an old meetingId would otherwise flip Finished -> Active and leave the
    // meeting stuck "live" in the UI. A fresh meeting must get a new _id.
    if (meeting.status === MeetingStatus.Finished) {
      this.ctx.warn('Refusing to re-activate finished meeting', { meeting: meeting._id })
      return
    }

    await this.client.update(meeting, { status: MeetingStatus.Active })
    this.ctx.info('Activated meeting', { meeting: meeting._id })
  }

  /**
   * Mark meeting as finished.
   * No activity message is added - status change is reflected in meeting document.
   * Also cleans up all ParticipantInfo entries for this meeting.
   */
  async finishMeeting (ref: Ref<MeetingMinutes>, meetingEnd?: number): Promise<void> {
    if (ref === undefined) return

    const meeting = await this.client.findOne(love.class.MeetingMinutes, { _id: ref })
    if (meeting === undefined) {
      this.ctx.error('Meeting not found', { _id: ref })
      return
    }

    const endTs = meetingEnd ?? Date.now()
    const upd: DocumentUpdate<MeetingMinutes> = { status: MeetingStatus.Finished, meetingEnd: endTs }
    if (meeting.transcriptionState === TranscriptionState.Transcribing) {
      upd.transcriptionState = TranscriptionState.Finished
    }
    if (meeting.recordingState === RecordingState.Recording) {
      meeting.recordingState = RecordingState.Finished
    }
    await this.client.update(meeting, upd)
    this.ctx.info('Marked meeting as finished', { meeting: meeting._id, meetingEnd: endTs })

    // Clean up all ParticipantInfo entries for this meeting
    await this.cleanupParticipantInfosForMeeting(ref)
  }

  /**
   * Remove all ParticipantInfo entries for a given meeting.
   * Called when meeting is finished to ensure no stale participant records remain.
   */
  private async cleanupParticipantInfosForMeeting (meeting: Ref<MeetingMinutes>): Promise<void> {
    try {
      const participantInfos = await this.client.findAll(love.class.ParticipantInfo, { meeting })
      for (const info of participantInfos) {
        await this.client.remove(info)
        this.ctx.info('[WorkspaceClient.cleanupParticipantInfosForMeeting] Removed ParticipantInfo', {
          infoId: info._id,
          person: info.person,
          meeting
        })
      }
      this.ctx.info('[WorkspaceClient.cleanupParticipantInfosForMeeting] Cleaned up participants for meeting', {
        meeting,
        count: participantInfos.length
      })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.cleanupParticipantInfosForMeeting] Failed', {
        error: err?.message ?? String(err),
        meeting
      })
    }
  }

  async checkUnfinishedMeetings (meetingMinutes: Ref<MeetingMinutes>[]): Promise<void> {
    try {
      // Find all active or pending meetings in this workspace
      const meetings = await this.client.findAll(love.class.MeetingMinutes, {
        _id: { $nin: meetingMinutes },
        status: { $ne: MeetingStatus.Finished }
      })

      for (const meeting of meetings) {
        await this.finishMeeting(meeting._id, Date.now())
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.checkUnfinishedMeetings] Failed', { error: err?.message ?? String(err) })
    }
  }

  /**
   * Clean up orphaned ParticipantInfo entries that reference finished meetings.
   * This handles cases where ParticipantInfo was not cleaned up when a meeting finished
   * (e.g., due to a bug or service restart before cleanup could complete).
   */
  async cleanupOrphanedParticipantInfos (): Promise<void> {
    try {
      // Find all ParticipantInfo entries first
      const allParticipantInfos = await this.client.findAll(love.class.ParticipantInfo, {})

      if (allParticipantInfos.length === 0) {
        return
      }

      // Get unique meeting IDs from ParticipantInfo entries
      const meetingIds = [...new Set(allParticipantInfos.map((info) => info.meeting))]

      // Find which of these meetings are finished
      const finishedMeetings = await this.client.findAll(love.class.MeetingMinutes, {
        _id: { $in: meetingIds },
        status: MeetingStatus.Finished
      })

      const finishedMeetingIds = new Set(finishedMeetings.map((m) => m._id))

      // Remove ParticipantInfo entries that reference finished meetings
      let removedCount = 0
      for (const info of allParticipantInfos) {
        if (finishedMeetingIds.has(info.meeting)) {
          await this.client.remove(info)
          removedCount++
          this.ctx.info('[WorkspaceClient.cleanupOrphanedParticipantInfos] Removed orphaned ParticipantInfo', {
            infoId: info._id,
            person: info.person,
            meeting: info.meeting
          })
        }
      }

      if (removedCount > 0) {
        this.ctx.info('[WorkspaceClient.cleanupOrphanedParticipantInfos] Cleaned up orphaned participants', {
          count: removedCount
        })
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.cleanupOrphanedParticipantInfos] Failed', {
        error: err?.message ?? String(err)
      })
    }
  }

  /**
   * Called from webhook when LiveKit reports a participant joined.
   * Ensures there is a ParticipantInfo for the given person and meeting.
   */
  async upsertParticipantFromLiveKit (
    person: Ref<Person>,
    name: string | null,
    account: AccountUuid | null,
    meeting: Ref<MeetingMinutes>,
    sessionId: string,
    participantMetadata: ParticipantMetadata
  ): Promise<void> {
    try {
      this.ctx.info('[WorkspaceClient.upsertParticipantFromLiveKit] Starting', { meeting, person, name, sessionId })

      const meetingDoc = await this.client.findOne(love.class.MeetingMinutes, { _id: meeting })
      this.ctx.info('[WorkspaceClient.upsertParticipantFromLivekit] Resolved meeting', {
        meeting,
        meetingDocFound: meetingDoc !== undefined
      })

      if (meetingDoc === undefined) {
        this.ctx.warn('[WorkspaceClient.upsertParticipantFromLivekit] Meeting document not found, cannot proceed', {
          meeting
        })
        return
      }
      const attachedRoom: Ref<Room> | undefined = meetingDoc.attachedTo as Ref<Room>

      const infos = await this.client.findAll(love.class.ParticipantInfo, {
        person,
        meeting,
        sessionId
      })

      if (infos.length > 1) {
        // Remove duplicates, keep the first one
        this.ctx.warn('[WorkspaceClient.upsertParticipantFromLivekit] Duplicate ParticipantInfo entries found', {
          person,
          meeting,
          duplicateCount: infos.length - 1
        })
        for (let i = 1; i < infos.length; i++) {
          const infoToRemove = infos[i]
          await this.client.remove(infoToRemove)
          this.ctx.info('[WorkspaceClient.upsertParticipantFromLivekit] Removed duplicate ParticipantInfo', {
            infoId: infoToRemove._id,
            person,
            meeting
          })
        }
        // Keep only the first one for further processing
        infos.splice(1)
      }

      if (infos.length === 1) {
        const info = infos[0]
        // ParticipantInfo already exists - update it with new meeting/session info
        this.ctx.info('[WorkspaceClient.upsertParticipantFromLivekit] Updating existing ParticipantInfo', {
          infoId: info._id,
          person,
          meeting
        })
        // Ensure the `meeting` field is set so clients can reliably discover current meeting
        // for this participant (fixes missing subscribe to join requests / knock notifications).
        await this.client.update(info, {
          meeting,
          room: attachedRoom ?? info.room,
          name: name ?? info.name,
          sessionId,
          account: account ?? info.account
        })
        this.ctx.info('[WorkspaceClient.upsertParticipantFromLivekit] Updated ParticipantInfo', {
          infoId: info._id,
          person,
          meeting
        })
      } else {
        // Create new ParticipantInfo - place will be allocated atomically to avoid collisions
        this.ctx.info('[WorkspaceClient.upsertParticipantFromLivekit] Creating new ParticipantInfo', {
          person,
          meeting,
          attachedRoom
        })
        const roomDoc =
          attachedRoom !== null ? await this.client.findOne(love.class.Room, { _id: attachedRoom }) : undefined

        const participants = await this.client.findAll(love.class.ParticipantInfo, { meeting })

        const place =
          roomDoc !== undefined
            ? getFreeRoomPlace(roomDoc, participants, person, {
                x: participantMetadata.x ?? 0,
                y: participantMetadata.y ?? 0
              })
            : { x: 0, y: 0 }
        const oid = generateId<ParticipantInfo>()

        await this.client.createDoc(
          love.class.ParticipantInfo,
          core.space.Workspace,
          {
            person,
            name: name ?? '',
            meeting,
            room: attachedRoom ?? null,
            x: place.x,
            y: place.y,
            sessionId: sessionId ?? null,
            account: account ?? null
          } as any,
          oid
        )
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.upsertParticipantFromLivekit] Failed', {
        error: err?.message ?? String(err),
        meeting,
        person
      })
    }
  }

  /**
   * Called from webhook when LiveKit reports a participant left.
   * Removes any ParticipantInfo records associated with the person.
   */
  async removeParticipantFromLiveKit (
    meeting: Ref<MeetingMinutes>,
    person: Ref<Person>,
    sessionId: string
  ): Promise<void> {
    try {
      const allInfos = await this.client.findAll(love.class.ParticipantInfo, { meeting, sessionId, person })
      const infos = allInfos.filter((it) => it.person === person)
      for (const info of infos) {
        await this.client.remove(info)
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.removeParticipantFromLivekit] Failed', {
        error: err?.message ?? String(err),
        person
      })
    }
  }

  /**
   * Find a Person ref by its id (returns undefined when not found).
   */
  async findPersonRefById (personId: Ref<Person>): Promise<Ref<Person> | undefined> {
    try {
      const persons = await this.client.findAll(contact.class.Person, { _id: personId })
      if (persons.length > 0) return persons[0]._id
      return undefined
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findPersonRefById] Failed', { error: err?.message ?? String(err), personId })
      return undefined
    }
  }

  /**
   * Find a person by name (attempts a few strategies: exact first/last match, full name match, case-insensitive regex).
   * Returns the first matching Person ref or undefined if not found.
   */
  async ensurePersonByName (guestId: string, firstName?: string, lastName?: string): Promise<Ref<Person> | undefined> {
    try {
      const person = await this.client.ensurePerson(SocialIdType.LOVE, guestId, firstName ?? '', lastName ?? '', {
        addGuestEmployee: true
      })
      return person.localPerson as Ref<Person>
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findPersonByName] Failed', {
        error: err?.message ?? String(err),
        firstName,
        lastName
      })
    }
  }

  async getPersonIdByPersonRef (personRef: Ref<Person>, name: string): Promise<PersonId | undefined> {
    try {
      const socialIds = await this.client.findAll(contact.class.SocialIdentity, { attachedTo: personRef }, { limit: 1 })
      if (socialIds.length > 0) {
        return socialIds[0]._id
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.getPersonIdByPersonRef] Failed', {
        error: err?.message ?? String(err),
        personRef
      })
      return undefined
    }
  }

  /**
   * Find MeetingMinutes document by id.
   */
  async findMeetingById (meetingId: Ref<MeetingMinutes>): Promise<MeetingMinutes | undefined> {
    try {
      return await this.client.findOne(love.class.MeetingMinutes, { _id: meetingId })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findMeetingById] Failed', { error: err?.message ?? String(err), meetingId })
      return undefined
    }
  }

  async findRoomById (roomId: Ref<Room>): Promise<Room | undefined> {
    try {
      return await this.client.findOne(love.class.Room, { _id: roomId })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findRoomById] Failed', { error: err?.message ?? String(err), roomId })
      return undefined
    }
  }

  /**
   * Find all ParticipantInfo entries for a given meeting.
   */
  async findParticipantInfosByMeeting (meeting: Ref<MeetingMinutes>): Promise<ParticipantInfo[]> {
    try {
      return await this.client.findAll(love.class.ParticipantInfo, { meeting })
    } catch (err: any) {
      return []
    }
  }

  /**
   * Remove a ParticipantInfo entry by its document ID.
   */
  async removeParticipantInfoById (participantInfoId: Ref<ParticipantInfo>): Promise<void> {
    try {
      const info = await this.client.findOne(love.class.ParticipantInfo, { _id: participantInfoId })
      if (info !== undefined) {
        await this.client.remove(info)
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.removeParticipantInfoById] Failed', {
        error: err?.message ?? String(err),
        participantInfoId
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PendingRecording management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a PendingRecording document when recording starts (from /startRecord endpoint).
   * This tracks in-progress recordings until they complete (egress_ended webhook).
   * Uses addCollection to attach to MeetingMinutes.
   */
  async createPendingRecording (params: {
    meeting: Ref<MeetingMinutes>
    format: RecordingFormat
    roomName: string
    name: string
    egressId?: string
  }): Promise<Ref<PendingRecording> | undefined> {
    try {
      const meetingDoc = await this.client.findOne(love.class.MeetingMinutes, { _id: params.meeting })
      if (meetingDoc === undefined) {
        this.ctx.error('[WorkspaceClient.createPendingRecording] Meeting not found', { meeting: params.meeting })
        return undefined
      }

      const docId = await this.client.addCollection(
        love.class.PendingRecording,
        meetingDoc.space,
        meetingDoc._id,
        meetingDoc._class,
        'recordings',
        {
          format: params.format,
          startedAt: Date.now(),
          roomName: params.roomName,
          name: params.name,
          egressId: params.egressId,
          status: 'active'
        }
      )
      this.ctx.info('[WorkspaceClient.createPendingRecording] Created', {
        docId,
        meeting: params.meeting,
        format: params.format,
        roomName: params.roomName,
        name: params.name
      })
      return docId
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.createPendingRecording] Failed', {
        error: err?.message ?? String(err),
        meeting: params.meeting,
        name: params.name
      })
      return undefined
    }
  }

  /**
   * Find a PendingRecording by its egress ID.
   */
  async findPendingRecordingByEgressId (egressId: string): Promise<PendingRecording | undefined> {
    try {
      return await this.client.findOne(love.class.PendingRecording, { egressId })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findPendingRecordingByEgressId] Failed', {
        error: err?.message ?? String(err),
        egressId
      })
      return undefined
    }
  }

  /**
   * Find all PendingRecording entries for a given meeting.
   */
  async findPendingRecordingsByMeeting (meeting: Ref<MeetingMinutes>): Promise<PendingRecording[]> {
    try {
      return await this.client.findAll(love.class.PendingRecording, { attachedTo: meeting })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findPendingRecordingsByMeeting] Failed', {
        error: err?.message ?? String(err),
        meeting
      })
      return []
    }
  }

  /**
   * Remove a PendingRecording document by its egress ID and return the removed document.
   * Called when egress (recording) ends.
   */
  async removePendingRecording (pendingRecording: PendingRecording): Promise<void> {
    try {
      await this.client.remove(pendingRecording)
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.removePendingRecordingByEgressId] Failed', {
        error: err?.message ?? String(err)
      })
      return undefined
    }
  }

  /**
   * Mark a PendingRecording as cancelled.
   * Called when recording is stopped by user before egress completes.
   */
  async cancelPendingRecording (pendingRecording: PendingRecording): Promise<void> {
    try {
      await this.client.update(pendingRecording, { status: 'cancelled' })
      this.ctx.info('[WorkspaceClient.cancelPendingRecording] Marked as cancelled', {
        docId: pendingRecording._id,
        egressId: pendingRecording.egressId,
        format: pendingRecording.format
      })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.cancelPendingRecording] Failed', {
        error: err?.message ?? String(err),
        docId: pendingRecording._id
      })
    }
  }

  /**
   * Update a PendingRecording's size (called during egress_updated webhooks).
   */
  async updatePendingRecordingSize (egressId: string, size: number): Promise<void> {
    try {
      const pending = await this.client.findOne(love.class.PendingRecording, { egressId })
      if (pending !== undefined) {
        await this.client.update(pending, { size })
        this.ctx.info('[WorkspaceClient.updatePendingRecordingSize] Updated', {
          docId: pending._id,
          egressId,
          size
        })
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.updatePendingRecordingSize] Failed', {
        error: err?.message ?? String(err),
        egressId,
        size
      })
    }
  }

  /**
   * Update MeetingMinutes recording state.
   */
  async updateMeetingRecordingState (meetingDoc: MeetingMinutes, state: RecordingState): Promise<void> {
    try {
      await this.client.update(meetingDoc, { recordingState: state })
      this.ctx.info('[WorkspaceClient.updateMeetingRecordingState] Updated', { meeting: meetingDoc._id, state })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.updateMeetingRecordingState] Failed', {
        error: err?.message ?? String(err),
        meeting: meetingDoc._id,
        state
      })
    }
  }

  /**
   * Remove a PendingRecording document by its document ID.
   */
  async removePendingRecordingById (pendingId: Ref<PendingRecording>): Promise<void> {
    try {
      const pending = await this.client.findOne(love.class.PendingRecording, { _id: pendingId })
      if (pending !== undefined) {
        await this.client.remove(pending)
      }
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.removePendingRecordingById] Failed', {
        error: err?.message ?? String(err),
        pendingId
      })
    }
  }

  /**
   * Find the first active PendingRecording for a meeting.
   */
  async findActivePendingRecording (meeting: Ref<MeetingMinutes>): Promise<PendingRecording | undefined> {
    try {
      return await this.client.findOne(love.class.PendingRecording, { attachedTo: meeting })
    } catch (err: any) {
      this.ctx.error('[WorkspaceClient.findActivePendingRecording] Failed', {
        error: err?.message ?? String(err),
        meeting
      })
      return undefined
    }
  }
}
