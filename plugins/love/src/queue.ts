import { Person } from '@hcengineering/contact'
import type { Ref } from '@hcengineering/core'
import { MeetingMinutes, RoomMetadata } from './types'

export enum QueueMeetingEvent {
  started = 'created',
  finished = 'finished',
  personJoined = 'person-joined',
  personLeft = 'person-left',
  updated = 'updated',
  recordingStarted = 'recording-started',
  recordingStopped = 'recording-stopped',
  languageUpdated = 'language-updated',
  transcriptionStarted = 'transcription-started',
  transcriptionFinished = 'transcription-finished',
  webhook = 'webhook', // A raw webhook message
  egressEvent = 'egress',
  updateMetadata = 'update-metadata'
}

export interface QueueMeetingMessage {
  type: QueueMeetingEvent
  meetingId: Ref<MeetingMinutes>
}

export interface QueueWebhookMeetingMessage extends QueueMeetingMessage {
  type: QueueMeetingEvent.webhook
  webhook: any
}

export interface QueueMeetingPersonMessage extends QueueMeetingMessage {
  type: QueueMeetingEvent.personJoined | QueueMeetingEvent.personLeft

  person: Ref<Person>
  identity: string
}

export interface QueueMeetingEgressMessage extends QueueMeetingMessage {
  type: QueueMeetingEvent.egressEvent

  egressId: string
  egressStatus: 'started' | 'updated' | 'ended'
  meta: Record<string, any>
}
export interface QueueMeetingUpdateMetadataMessage extends QueueMeetingMessage {
  type: QueueMeetingEvent.updateMetadata

  roomName: string
  metadata: Partial<RoomMetadata>
}

export const queueEvents = {
  started: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({ type: QueueMeetingEvent.started, meetingId }),
  finished: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({ type: QueueMeetingEvent.finished, meetingId }),
  personJoined: (meetingId: Ref<MeetingMinutes>, person: Ref<Person>, identity: string): QueueMeetingPersonMessage => ({
    type: QueueMeetingEvent.personJoined,
    meetingId,
    person,
    identity
  }),
  personLeft: (meetingId: Ref<MeetingMinutes>, person: Ref<Person>, identity: string): QueueMeetingPersonMessage => ({
    type: QueueMeetingEvent.personLeft,
    meetingId,
    person,
    identity
  }),
  updated: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({ type: QueueMeetingEvent.updated, meetingId }),
  recordingStarted: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({
    type: QueueMeetingEvent.recordingStarted,
    meetingId
  }),
  recordingStopped: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({
    type: QueueMeetingEvent.recordingStopped,
    meetingId
  }),
  languageUpdated: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({
    type: QueueMeetingEvent.languageUpdated,
    meetingId
  }),
  transcriptionStarted: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({
    type: QueueMeetingEvent.transcriptionStarted,
    meetingId
  }),
  transcriptionFinished: (meetingId: Ref<MeetingMinutes>): QueueMeetingMessage => ({
    type: QueueMeetingEvent.transcriptionFinished,
    meetingId
  }),
  webhook: (meetingId: Ref<MeetingMinutes>, webhook: any): QueueWebhookMeetingMessage => ({
    type: QueueMeetingEvent.webhook,
    meetingId,
    webhook
  }),
  egressEvent: (
    meetingId: Ref<MeetingMinutes>,
    egressId: string,
    egressStatus: 'started' | 'updated' | 'ended',
    meta: Record<string, any>
  ): QueueMeetingEgressMessage => ({
    type: QueueMeetingEvent.egressEvent,
    meetingId,
    egressId,
    egressStatus,
    meta
  }),
  updateMetadata: (
    meetingId: Ref<MeetingMinutes>,
    roomName: string,
    metadata: Partial<RoomMetadata>
  ): QueueMeetingUpdateMetadataMessage => ({
    type: QueueMeetingEvent.updateMetadata,
    roomName,
    meetingId,
    metadata
  })
}
