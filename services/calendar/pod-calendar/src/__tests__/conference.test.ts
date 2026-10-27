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

import { getConferenceLink, getEventLocation, isLocationInSync } from '../conference'

const meet = 'https://meet.google.com/abc-defg-hij'

describe('getConferenceLink', () => {
  it('returns hangoutLink', () => {
    expect(getConferenceLink({ hangoutLink: meet })).toBe(meet)
  })

  it('falls back to the video entry point of conferenceData', () => {
    expect(
      getConferenceLink({
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
            { entryPointType: 'video', uri: meet }
          ]
        }
      })
    ).toBe(meet)
  })

  it('returns undefined without conference', () => {
    expect(getConferenceLink({})).toBeUndefined()
    expect(getConferenceLink({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }] } })).toBe(
      undefined
    )
  })
})

describe('getEventLocation', () => {
  it('keeps an explicit location', () => {
    expect(getEventLocation({ location: 'Room 1', hangoutLink: meet })).toBe('Room 1')
  })

  it('uses the conference link when location is missing or empty', () => {
    expect(getEventLocation({ hangoutLink: meet })).toBe(meet)
    expect(getEventLocation({ location: '', hangoutLink: meet })).toBe(meet)
    expect(getEventLocation({ location: '  ', hangoutLink: meet })).toBe(meet)
  })

  it('is stable on repeated calls', () => {
    const event = { hangoutLink: meet }
    expect(getEventLocation(event)).toBe(getEventLocation(event))
  })

  it('keeps previous behaviour without conference', () => {
    expect(getEventLocation({})).toBeUndefined()
    expect(getEventLocation({ location: null })).toBeUndefined()
    expect(getEventLocation({ location: '' })).toBe('')
  })
})

describe('isLocationInSync', () => {
  it('treats the conference link stored as location as in sync with an empty Google location', () => {
    expect(isLocationInSync(meet, { hangoutLink: meet })).toBe(true)
    expect(isLocationInSync(meet, { location: '', hangoutLink: meet })).toBe(true)
  })

  it('keeps a location cleared in Huly cleared (no diff, no restore of the link)', () => {
    // Huly cleared the location, Google was updated to '' while hangoutLink stays
    const google = { location: '', hangoutLink: meet }
    expect(isLocationInSync('', google)).toBe(true)
    expect(isLocationInSync(undefined, google)).toBe(true)
  })

  it('detects clearing a real Google location', () => {
    expect(isLocationInSync('', { location: 'Room 1', hangoutLink: meet })).toBe(false)
    expect(isLocationInSync(undefined, { location: 'Room 1' })).toBe(false)
  })

  it('detects a changed location', () => {
    expect(isLocationInSync('Room 2', { location: 'Room 1', hangoutLink: meet })).toBe(false)
    expect(isLocationInSync('Room 2', { hangoutLink: meet })).toBe(false)
  })

  it('round trip: link imported on create, cleared by user, stays cleared', () => {
    const google: { location?: string, hangoutLink: string } = { hangoutLink: meet }
    let huly: string | undefined = getEventLocation(google) // import on create
    expect(huly).toBe(meet)
    expect(isLocationInSync(huly, google)).toBe(true)
    huly = '' // user clears the location in Huly
    expect(isLocationInSync(huly, google)).toBe(true)
    // incoming update uses the raw Google location, so nothing restores the link
    const imported = google.location ?? huly
    expect(imported).toBe('')
  })
})
