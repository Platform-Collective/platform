import { Class, Mixin, Ref } from '@hcengineering/core'
import { Drive } from '@hcengineering/drive'
import { NotificationGroup, NotificationType } from '@hcengineering/notification'
import { Asset, IntlString, Metadata as ServiceEndpoint, Plugin, plugin } from '@hcengineering/platform'
import { AnyComponent } from '@hcengineering/ui/src/types'
import { Action, Viewlet, ViewletDescriptor } from '@hcengineering/view'
import { Widget } from '@hcengineering/workbench'
import {
  DevicesPreference,
  Floor,
  MeetingEventLink,
  MeetingMinutes,
  MeetingSchedule,
  Office,
  ParticipantInfo,
  PendingRecording,
  Room,
  RoomAccess,
  RoomInfo,
  UserMeetingInvite
} from './types'

export const loveId = 'love' as Plugin

const love = plugin(loveId, {
  class: {
    Room: '' as Ref<Class<Room>>,
    Floor: '' as Ref<Class<Floor>>,
    Office: '' as Ref<Class<Office>>,
    ParticipantInfo: '' as Ref<Class<ParticipantInfo>>,
    PendingRecording: '' as Ref<Class<PendingRecording>>,
    DevicesPreference: '' as Ref<Class<DevicesPreference>>,
    RoomInfo: '' as Ref<Class<RoomInfo>>,
    MeetingMinutes: '' as Ref<Class<MeetingMinutes>>,
    UserMeetingInvite: '' as Ref<Class<UserMeetingInvite>>
  },
  mixin: {
    MeetingEventLink: '' as Ref<Mixin<MeetingEventLink>>,
    MeetingSchedule: '' as Ref<Mixin<MeetingSchedule>>
  },
  action: {
    ToggleMic: '' as Ref<Action>,
    ToggleVideo: '' as Ref<Action>
  },
  string: {
    Office: '' as IntlString,
    MyOffice: '' as IntlString,
    Room: '' as IntlString,
    IsKnocking: '' as IntlString,
    KnockingLabel: '' as IntlString,
    InvitingYou: '' as IntlString,
    MeetingRequest: '' as IntlString,
    Kind: '' as IntlString,
    RoomType: '' as IntlString,
    Knock: '' as IntlString,
    Open: '' as IntlString,
    DND: '' as IntlString,
    StartTranscription: '' as IntlString,
    StopTranscription: '' as IntlString,
    Meeting: '' as IntlString,
    Transcription: '' as IntlString,
    TranscriptionState: '' as IntlString,
    TranscriptionNotStarted: '' as IntlString,
    TranscriptionTranscribing: '' as IntlString,
    TranscriptionFinished: '' as IntlString,
    StartWithTranscription: '' as IntlString,
    // Guest join labels
    GuestFirstName: '' as IntlString,
    GuestLastName: '' as IntlString,
    // Start-with toggles for guest join
    StartWithVideo: '' as IntlString,
    StartWithAudio: '' as IntlString,
    MeetingMinutes: '' as IntlString,
    MeetingsMinutes: '' as IntlString,
    StartMeeting: '' as IntlString,
    Video: '' as IntlString,
    NoMeetingMinutes: '' as IntlString,
    JoinMeeting: '' as IntlString,
    JoinedMeeting: '' as IntlString,
    Accept: '' as IntlString,
    Decline: '' as IntlString,
    Join: '' as IntlString,
    Reject: '' as IntlString,
    MeetingStart: '' as IntlString,
    MeetingEnd: '' as IntlString,
    Status: '' as IntlString,
    Active: '' as IntlString,
    Finished: '' as IntlString,
    Pending: '' as IntlString,
    StartWithRecording: '' as IntlString,
    RecordingState: '' as IntlString,
    RecordingNotStarted: '' as IntlString,
    RecordingRecording: '' as IntlString,
    RecordingFinished: '' as IntlString,
    Recording: '' as IntlString,
    StoppingRecord: '' as IntlString,
    Kick: '' as IntlString,
    EndMeeting: '' as IntlString,
    SearchMeetingMinutes: '' as IntlString,
    FinishMeeting: '' as IntlString,
    AddParticipant: '' as IntlString,
    LeaveParticipant: '' as IntlString,
    KnockAction: '' as IntlString,
    KnockingTo: '' as IntlString,
    ShowParticipants: '' as IntlString,
    HideParticipants: '' as IntlString,
    Scheduled: '' as IntlString,
    ScheduledIn: '' as IntlString,
    WaitForHost: '' as IntlString
  },
  ids: {
    MainFloor: '' as Ref<Floor>,
    Reception: '' as Ref<Room>,
    InviteNotification: '' as Ref<NotificationType>,
    KnockNotification: '' as Ref<NotificationType>,
    LoveWidget: '' as Ref<Widget>,
    MeetingWidget: '' as Ref<Widget>,
    LoveNotificationGroup: '' as Ref<NotificationGroup>
  },
  icon: {
    Love: '' as Asset,
    LeaveRoom: '' as Asset,
    EnterRoom: '' as Asset,
    Mic: '' as Asset,
    MicEnabled: '' as Asset,
    MicDisabled: '' as Asset,
    Cam: '' as Asset,
    CamEnabled: '' as Asset,
    CamDisabled: '' as Asset,
    SharingEnabled: '' as Asset,
    SharingDisabled: '' as Asset,
    Open: '' as Asset,
    Knock: '' as Asset,
    DND: '' as Asset,
    Record: '' as Asset,
    StopRecord: '' as Asset,
    FullScreen: '' as Asset,
    ExitFullScreen: '' as Asset,
    Invite: '' as Asset,
    Kick: '' as Asset,
    MeetingMinutes: '' as Asset
  },
  sound: {
    Knock: '' as Asset,
    MeetingEndNotification: '' as Asset
  },
  metadata: {
    WebSocketURL: '' as ServiceEndpoint<string>,
    ServiceEndpoint: '' as ServiceEndpoint<string>
  },
  space: {
    Drive: '' as Ref<Drive>
  },
  component: {
    SelectScreenSourcePopup: '' as AnyComponent,
    GuestMeetingApp: '' as AnyComponent
  },
  viewlet: {
    TableMeetingMinutes: '' as Ref<Viewlet>,
    TableMeetingMinutesEmbedded: '' as Ref<Viewlet>,
    MeetingMinutesDescriptor: '' as Ref<ViewletDescriptor>,
    FloorDescriptor: '' as Ref<ViewletDescriptor>,
    Floor: '' as Ref<Viewlet>,
    FloorMeetingMinutes: '' as Ref<Viewlet>
  }
})

export const roomAccessIcon = {
  [RoomAccess.Open]: love.icon.Open,
  [RoomAccess.Knock]: love.icon.Knock,
  [RoomAccess.DND]: love.icon.DND
}

export const roomAccessLabel = {
  [RoomAccess.Open]: love.string.Open,
  [RoomAccess.Knock]: love.string.Knock,
  [RoomAccess.DND]: love.string.DND
}

export default love
