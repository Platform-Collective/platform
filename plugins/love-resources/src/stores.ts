import { aiBotSocialIdentityStore } from '@hcengineering/ai-bot-resources'
import { getCurrentEmployee, type Person } from '@hcengineering/contact'
import { getPersonRefByPersonId, getPersonsByPersonRefs } from '@hcengineering/contact-resources'
import { type Ref } from '@hcengineering/core'
import { createQuery, onClient } from '@hcengineering/presentation'
import {
  isOffice,
  MeetingStatus,
  type PendingRecording,
  type DevicesPreference,
  type Floor,
  type MeetingMinutes,
  type Office,
  type ParticipantInfo,
  type Room
} from '@hcengineering/love'
import { derived, get, writable } from 'svelte/store'

import love from './plugin'

// Client-side store to indicate current session is attempting to connect to a meeting
export const myConnectingSessionId = writable<string | null>(null)
export const isLocalConnecting = derived(myConnectingSessionId, (v) => v !== null)

export const rooms = writable<Room[]>([])
export const meetings = writable<MeetingMinutes[]>([])
export const pendingRecordings = writable<PendingRecording[]>([])

export const myOffice = derived(rooms, (val) => {
  const personId = getCurrentEmployee()
  return val.find((p) => (p as Office).person === personId) as Office | undefined
})
export const infos = writable<ParticipantInfo[]>([])
export const myInfo = derived(infos, (val) => {
  const personId = getCurrentEmployee()
  return val.find((p) => p.person === personId)
})

export const currentMeetingMinutes = derived([meetings, myInfo], ([meetings, myInfo]) => {
  return myInfo !== undefined ? meetings.find((p) => p._id === myInfo.meeting) : undefined
})
export const currentRoom = derived([rooms, myInfo], ([rooms, myInfo]) => {
  return myInfo !== undefined ? rooms.find((p) => p._id === myInfo.room) : undefined
})

export const currentAudioRecording = derived(
  [pendingRecordings, currentMeetingMinutes],
  ([pending, currentMeeting]) => {
    if (currentMeeting == null) {
      return undefined
    }
    return pending.find((it) => it.format === 'audio' && it.attachedTo === currentMeeting._id)
  }
)

export const currentVideoRecording = derived(
  [pendingRecordings, currentMeetingMinutes],
  ([pending, currentMeeting]) => {
    if (currentMeeting == null) {
      return undefined
    }
    return pending.find((it) => it.format === 'video' && it.attachedTo === currentMeeting._id)
  }
)

export const isCancellingVideoRecording = derived(
  [pendingRecordings, currentMeetingMinutes],
  ([pending, currentMeeting]) => {
    if (currentMeeting == null) {
      return false
    }
    const videoRec = pending.find((it) => it.format === 'video' && it.attachedTo === currentMeeting._id)
    return videoRec?.status === 'cancelled'
  }
)

export const floors = writable<Floor[]>([])
export const selectedFloor = writable<Ref<Floor> | undefined>(undefined)
export const activeFloor = derived([rooms, myInfo, myOffice], ([rooms, myInfo, myOffice]) => {
  let res: Ref<Floor> | undefined
  if (myInfo !== undefined) {
    res = rooms.find((p) => p._id === myInfo.room)?.floor
  }
  if (res === undefined && myOffice !== undefined) {
    res = rooms.find((p) => p._id === myOffice._id)?.floor
  }
  return res ?? love.ids.MainFloor
})

export const myPreferences = writable<DevicesPreference | undefined>()
export let $myPreferences: DevicesPreference | undefined

export const selectedRoomPlace = writable<{ _id: Ref<Room>, x: number, y: number } | undefined>(undefined)

async function filterParticipantInfo (value: ParticipantInfo[]): Promise<ParticipantInfo[]> {
  const map = new Map<string, ParticipantInfo>()
  const aiSid = get(aiBotSocialIdentityStore)
  const aiPerson = aiSid !== undefined ? await getPersonRefByPersonId(aiSid._id) : undefined
  for (const val of value) {
    if (aiPerson !== undefined && val.person === aiPerson) {
      map.set(val._id, val)
    } else {
      map.set(val.person, val)
    }
  }
  return Array.from(map.values())
}

const officeLoaded = writable(false)

const query = createQuery(true)
const statusQuery = createQuery(true)
const floorsQuery = createQuery(true)
const preferencesQuery = createQuery(true)
const meetingsQuery = createQuery(true)
const pendingRecordingQuery = createQuery(true)

onClient(() => {
  const roomPromise = new Promise<void>((resolve) =>
    query.query(love.class.Room, {}, (res) => {
      rooms.set(res)

      // cache for all office persons
      void getPersonsByPersonRefs(
        res
          .filter((it) => isOffice(it))
          .map((it) => it.person)
          .filter((it) => it != null)
      )
      resolve()
    })
  )
  const infoPromise = new Promise<void>((resolve) =>
    statusQuery.query(love.class.ParticipantInfo, {}, async (res) => {
      infos.set(await filterParticipantInfo(res))
      resolve()
    })
  )
  const floorPromise = new Promise<void>((resolve) =>
    floorsQuery.query(love.class.Floor, {}, (res) => {
      floors.set(res)
      resolve()
    })
  )
  const preferencePromise = new Promise<void>((resolve) =>
    preferencesQuery.query(love.class.DevicesPreference, {}, (res) => {
      myPreferences.set(res[0])
      $myPreferences = res[0]
      resolve()
    })
  )

  // All active meetings
  const meetingsPromise = new Promise<void>((resolve) =>
    meetingsQuery.query(
      love.class.MeetingMinutes,
      {
        status: { $ne: MeetingStatus.Finished }
      },
      (res) => {
        meetings.set(res)
        resolve()
      }
    )
  )

  const pendingRecordingPromise = new Promise<void>((resolve) => {
    pendingRecordingQuery.query(love.class.PendingRecording, {}, (result) => {
      pendingRecordings.set(result)
      resolve()
    })
  })

  void Promise.all([
    roomPromise,
    infoPromise,
    floorPromise,
    preferencePromise,
    meetingsPromise,
    pendingRecordingPromise
  ]).then(() => {
    officeLoaded.set(true)
  })
})

export async function waitForOfficeLoaded (): Promise<void> {
  if (!get(officeLoaded)) {
    await new Promise((resolve) => {
      const unsubscribe = officeLoaded.subscribe((loaded) => {
        if (loaded) {
          unsubscribe()
          resolve(null)
        }
      })
    })
  }
}

export const lockedRoom = writable<string>('')

// True when the local user talks while their microphone is muted.
export const speakingWhileMuted = writable<boolean>(false)

// Store to track if RoomModal is active - when true, video should be hidden in ParticipantsListView
export const roomModalActive = writable<boolean>(false)

// Store to control visibility of participants in modal mode
export const showParticipantsInModal = writable<boolean>(true)

// Store that maps personId -> their primary office (first one by _id)
// This fixes the issue where a person assigned to multiple offices appears in all of them
export const personPrimaryOffice = derived(rooms, (val) => {
  const officeMap = new Map<Ref<Person>, Office>()
  const allOffices = val.filter((r) => isOffice(r))

  // Sort offices by _id to ensure consistent ordering
  const sortedOffices = [...allOffices].sort((a, b) => a._id.localeCompare(b._id))

  for (const office of sortedOffices) {
    if (office.person != null && !officeMap.has(office.person)) {
      officeMap.set(office.person, office)
    }
  }

  return officeMap
})
