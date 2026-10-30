//
// Copyright © 2026 Hardcore Engineering Inc.
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
//

// Round trips through the real incoming (IncomingSyncManager) and outgoing (OutcomingClient, CalendarClient) sync code.

import { type Event, type ExternalCalendar } from '@hcengineering/calendar'
import { type Ref } from '@hcengineering/core'
import { type calendar_v3 } from 'googleapis'
import { CalendarClient } from '../calendar'
import { OutcomingClient } from '../outcomingClient'
import { IncomingSyncManager } from '../sync'

jest.mock('../config', () => ({
  __esModule: true,
  default: { Credentials: undefined, WATCH_URL: undefined, GoogleEnabled: false, KvsUrl: '', ServiceID: '', Secret: '' }
}))

const meetA = 'https://meet.google.com/aaa-aaaa-aaa'
const meetB = 'https://meet.google.com/bbb-bbbb-bbb'
const start = '2026-11-02T10:00:00.000Z'
const end = '2026-11-02T11:00:00.000Z'
const ctx: any = { info: () => {}, warn: () => {}, error: () => {} }

type Google = calendar_v3.Schema$Event

/** A Google event with its server-side state and a Huly copy kept in sync by the real sync code. */
class Harness {
  google: Google
  huly: Event | undefined
  readonly writes: Google[] = []
  readonly incoming: IncomingSyncManager
  readonly outgoing: OutcomingClient
  readonly legacyOutgoing: CalendarClient

  constructor (google: Google) {
    this.google = {
      id: 'ev1',
      summary: 'Sync',
      description: '',
      start: { dateTime: start },
      end: { dateTime: end },
      ...google
    }

    const hulyClient: any = {
      update: async (doc: Event, diff: any) => {
        Object.assign(doc, diff)
      },
      findAll: async () => [],
      getHierarchy: () => ({ isMixin: () => false })
    }
    const systemClient: any = {
      addCollection: async (
        _class: Ref<Event>,
        space: any,
        attachedTo: any,
        attachedToClass: any,
        collection: string,
        data: any
      ) => {
        const created: Event = {
          _id: 'huly-ev1',
          _class,
          space,
          attachedTo,
          attachedToClass,
          collection,
          modifiedOn: 0,
          modifiedBy: 'user',
          ...data
        }
        this.huly = created
        return created._id
      }
    }

    this.incoming = Object.create(IncomingSyncManager.prototype)
    Object.assign(this.incoming, {
      ctx,
      client: hulyClient,
      systemClient,
      user: { userId: 'user', email: 'me@example.com' }
    })
    ;(this.incoming as any).getParticipants = async () => [[], []]

    this.outgoing = Object.create(OutcomingClient.prototype)
    Object.assign(this.outgoing, { ctx, client: hulyClient, workspace: 'ws', user: { email: 'me@example.com' } })

    this.legacyOutgoing = Object.create(CalendarClient.prototype)
    Object.assign(this.legacyOutgoing, {
      ctx,
      client: hulyClient,
      user: { email: 'me@example.com', workspace: 'ws' },
      workspace: { participants: new Map() }
    })
  }

  /** Google -> Huly, as done for every changed Google event. */
  async syncIncoming (): Promise<void> {
    const event = structuredClone(this.google)
    if (this.huly === undefined) {
      const cal: ExternalCalendar = { _id: 'cal1' } as any
      await (this.incoming as any).saveExtEvent(event, 'owner', cal)
    } else {
      await (this.incoming as any).updateExtEvent(event, this.huly)
    }
  }

  /** The organizer changes the event in Google. */
  editInGoogle (patch: Google): void {
    this.google = { ...this.google, ...patch }
  }

  /** The user edits the event in Huly, then Huly -> Google is pushed through the given client. */
  async editInHuly (patch: Partial<Event>, legacy = false): Promise<void> {
    if (this.huly === undefined) throw new Error('not imported')
    Object.assign(this.huly, patch)
    const current = structuredClone(this.google)
    const updated: Google | undefined = legacy
      ? (this.legacyOutgoing as any).applyUpdate(current, this.huly)
      : await (this.outgoing as any).applyUpdate(current, this.huly)
    if (updated !== undefined) {
      this.writes.push(updated)
      this.google = updated
    }
  }

  /** The body sent to Google when the event is (re)created from Huly, e.g. after a 404 on update. */
  async createBody (legacy = false): Promise<Google> {
    return legacy
      ? (this.legacyOutgoing as any).convertBody(this.huly)
      : await (this.outgoing as any).convertBody(this.huly)
  }
}

describe.each([false, true])('conference link round trip (legacy client: %s)', (legacy) => {
  it('imports the link and does not write it into the Google location', async () => {
    const h = new Harness({ hangoutLink: meetA })
    await h.syncIncoming()
    expect(h.huly?.location).toBe(meetA)

    await h.editInHuly({ title: 'Renamed' }, legacy)
    expect(h.google.summary).toBe('Renamed')
    expect(h.google.location).toBeUndefined()
    expect((await h.createBody(legacy)).location).toBeUndefined()
  })

  it('follows a replaced link and keeps Google untouched on a later unrelated edit', async () => {
    const h = new Harness({ hangoutLink: meetA })
    await h.syncIncoming()

    h.editInGoogle({ hangoutLink: meetB })
    // An unrelated Huly edit pushed before the incoming sync must not write the stale link A into Google.
    await h.editInHuly({ title: 'Renamed' }, legacy)
    expect(h.google.location).toBeUndefined()

    await h.syncIncoming()
    expect(h.huly?.location).toBe(meetB)
    await h.editInHuly({ title: 'Renamed again' }, legacy)
    expect(h.google.location).toBeUndefined()
  })

  it('clears a removed link and does not bring it back', async () => {
    const h = new Harness({ hangoutLink: meetA })
    await h.syncIncoming()

    h.editInGoogle({ hangoutLink: undefined })
    await h.syncIncoming()
    expect(h.huly?.location).toBe('')

    await h.editInHuly({ title: 'Renamed' }, legacy)
    expect(h.google.location ?? '').toBe('')
    expect(h.google.hangoutLink).toBeUndefined()
    expect((await h.createBody(legacy)).location ?? '').toBe('')

    // A new conference added later is imported again.
    h.editInGoogle({ hangoutLink: meetB })
    await h.syncIncoming()
    expect(h.huly?.location).toBe(meetB)
  })

  it('keeps a link cleared by the user cleared', async () => {
    const h = new Harness({ hangoutLink: meetA })
    await h.syncIncoming()

    await h.editInHuly({ location: '' }, legacy)
    expect(h.google.location ?? '').toBe('')
    h.editInGoogle({ summary: 'Changed in Google' })
    await h.syncIncoming()
    expect(h.huly?.location).toBe('')
    expect(h.huly?.title).toBe('Changed in Google')
  })

  it('pushes a location entered by the user and keeps it over the link', async () => {
    const h = new Harness({ hangoutLink: meetA })
    await h.syncIncoming()

    await h.editInHuly({ location: 'Room 1' }, legacy)
    expect(h.google.location).toBe('Room 1')
    h.editInGoogle({ hangoutLink: meetB })
    await h.syncIncoming()
    expect(h.huly?.location).toBe('Room 1')
  })

  it('imports links of events synced before links were imported and links added later', async () => {
    const h = new Harness({})
    await h.syncIncoming()
    expect(h.huly?.location).toBeUndefined()

    h.editInGoogle({ hangoutLink: meetA })
    await h.syncIncoming()
    expect(h.huly?.location).toBe(meetA)
    await h.editInHuly({ title: 'Renamed' }, legacy)
    expect(h.google.location).toBeUndefined()
  })

  it('keeps an explicit Google location over the link', async () => {
    const h = new Harness({ location: 'Room 1', hangoutLink: meetA })
    await h.syncIncoming()
    expect(h.huly?.location).toBe('Room 1')
    h.editInGoogle({ location: 'Room 2' })
    await h.syncIncoming()
    expect(h.huly?.location).toBe('Room 2')
  })
})
