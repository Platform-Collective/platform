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

import {
  getConferenceLink,
  getEventLocation,
  getEventLocationUpdate,
  getOutgoingLocation,
  isLocationInSync
} from '../conference'

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

const meet2 = 'https://meet.google.com/xyz-uvwx-rst'

describe('getEventLocation', () => {
  it('prefers an explicit location', () => {
    expect(getEventLocation({ location: 'Room 1', hangoutLink: meet })).toEqual({ location: 'Room 1' })
  })

  it('uses the conference link when there is no location and remembers it as imported', () => {
    expect(getEventLocation({ hangoutLink: meet })).toEqual({ location: meet, importedConferenceLink: meet })
    expect(getEventLocation({ location: '  ', hangoutLink: meet })).toEqual({
      location: meet,
      importedConferenceLink: meet
    })
  })

  it('keeps an empty location when there is no conference', () => {
    expect(getEventLocation({})).toEqual({ location: undefined })
    expect(getEventLocation({ location: '' })).toEqual({ location: '' })
  })
})

describe('getEventLocationUpdate', () => {
  it('takes an explicit Google location', () => {
    expect(
      getEventLocationUpdate(
        { location: 'Room 1', hangoutLink: meet },
        { location: meet, importedConferenceLink: meet }
      )
    ).toEqual({
      location: 'Room 1'
    })
  })

  it('imports a link for events synced before links were imported', () => {
    expect(getEventLocationUpdate({ hangoutLink: meet }, {})).toEqual({ location: meet, importedConferenceLink: meet })
    expect(getEventLocationUpdate({ hangoutLink: meet }, { location: '' })).toEqual({
      location: meet,
      importedConferenceLink: meet
    })
  })

  it('follows a replaced or removed link', () => {
    expect(getEventLocationUpdate({ hangoutLink: meet2 }, { location: meet, importedConferenceLink: meet })).toEqual({
      location: meet2,
      importedConferenceLink: meet2
    })
    expect(getEventLocationUpdate({}, { location: meet, importedConferenceLink: meet })).toEqual({
      location: '',
      importedConferenceLink: ''
    })
    expect(getEventLocationUpdate({ hangoutLink: meet }, { location: '', importedConferenceLink: '' })).toEqual({
      location: meet,
      importedConferenceLink: meet
    })
  })

  it('does not restore a link the user cleared or replace a location the user entered', () => {
    expect(getEventLocationUpdate({ hangoutLink: meet }, { location: '', importedConferenceLink: meet })).toEqual({})
    expect(
      getEventLocationUpdate({ hangoutLink: meet2 }, { location: 'Room 1', importedConferenceLink: meet })
    ).toEqual({})
    expect(getEventLocationUpdate({ hangoutLink: meet }, { location: 'Room 1' })).toEqual({})
  })
})

describe('isLocationInSync / getOutgoingLocation', () => {
  it('never treats the imported link as a real location', () => {
    const imported = { location: meet, importedConferenceLink: meet }
    expect(isLocationInSync(imported, { hangoutLink: meet2 })).toBe(true)
    expect(isLocationInSync(imported, {})).toBe(true)
    expect(getOutgoingLocation(imported)).toBeUndefined()
  })

  it('detects real location changes', () => {
    expect(isLocationInSync({ location: '' }, { location: 'Room 1', hangoutLink: meet })).toBe(false)
    expect(isLocationInSync({ location: 'Room 2' }, { location: 'Room 1' })).toBe(false)
    expect(isLocationInSync({ location: 'Room 2', importedConferenceLink: meet }, { hangoutLink: meet })).toBe(false)
    expect(isLocationInSync({ location: undefined }, { location: '' })).toBe(true)
    expect(getOutgoingLocation({ location: 'Room 2', importedConferenceLink: meet })).toBe('Room 2')
  })
})
