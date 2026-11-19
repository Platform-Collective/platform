// SPDX-License-Identifier: EPL-2.0

import calendar, {
  AccessLevel,
  type Calendar,
  type ExternalCalendar,
  type PrimaryCalendar
} from '@hcengineering/calendar'
import core, {
  AccountRole,
  findProperty,
  setCurrentAccount,
  toFindResult,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type PersonId,
  type Ref
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'

import { findPrimaryCalendar } from '../utils'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

const ACCOUNT: Account = {
  uuid: 'account' as AccountUuid,
  primarySocialId: 'email-id' as PersonId,
  socialIds: ['email-id' as PersonId, 'google-id' as PersonId],
  fullSocialIds: [],
  role: AccountRole.User
}

function makeCalendar (overrides: Partial<ExternalCalendar> = {}): ExternalCalendar {
  return {
    _id: 'google-calendar' as Ref<ExternalCalendar>,
    _class: calendar.class.ExternalCalendar,
    space: core.space.Workspace,
    modifiedBy: ACCOUNT.primarySocialId,
    modifiedOn: 0,
    name: 'Google calendar',
    user: ACCOUNT.socialIds[1],
    hidden: false,
    visibility: 'public',
    access: AccessLevel.Owner,
    default: false,
    externalId: 'external-calendar',
    externalUser: 'user@example.com',
    ...overrides
  }
}

function makePreference (attachedTo: Ref<Calendar>): PrimaryCalendar {
  return {
    _id: 'primary-calendar' as Ref<PrimaryCalendar>,
    _class: calendar.class.PrimaryCalendar,
    space: core.space.Workspace,
    modifiedBy: ACCOUNT.primarySocialId,
    modifiedOn: 0,
    attachedTo
  }
}

describe('findPrimaryCalendar', () => {
  let calendars: Calendar[]
  let preference: PrimaryCalendar | undefined

  beforeEach(() => {
    setCurrentAccount(ACCOUNT)
    calendars = []
    preference = undefined
    jest.mocked(getClient).mockReturnValue({
      findAll: jest.fn(async (_class: Ref<Class<Calendar>>, query: DocumentQuery<Calendar>) => {
        const matches = Object.entries(query).reduce<Doc[]>(
          (docs, [key, value]) => findProperty(docs, key, value),
          calendars
        )
        return toFindResult(matches)
      }),
      findOne: jest.fn(async () => preference)
    } as unknown as ReturnType<typeof getClient>)
  })

  it('uses the preferred calendar belonging to a secondary social ID', async () => {
    const preferred = makeCalendar({ access: AccessLevel.Writer })
    calendars = [makeCalendar({ _id: 'google-default' as Ref<ExternalCalendar>, default: true }), preferred]
    preference = makePreference(preferred._id)

    expect(await findPrimaryCalendar()).toBe(preferred._id)
  })

  it('uses the default external calendar without a preference', async () => {
    const defaultCalendar = makeCalendar({ default: true })
    calendars = [defaultCalendar]

    expect(await findPrimaryCalendar()).toBe(defaultCalendar._id)
  })

  it('preserves a preferred calendar belonging to the primary social ID', async () => {
    const internal = makeCalendar({
      _id: `${ACCOUNT.uuid}_calendar` as Ref<ExternalCalendar>,
      _class: calendar.class.Calendar,
      user: ACCOUNT.primarySocialId
    })
    calendars = [makeCalendar({ default: true }), internal]
    preference = makePreference(internal._id)

    expect(await findPrimaryCalendar()).toBe(internal._id)
  })

  it.each([
    { hidden: true },
    { access: AccessLevel.Reader },
    { access: AccessLevel.FreeBusyReader },
    { user: 'another-user' as ExternalCalendar['user'] }
  ])('ignores unavailable external calendars: %j', async (overrides) => {
    const unavailable = makeCalendar({ default: true, ...overrides })
    calendars = [unavailable]
    preference = makePreference(unavailable._id)

    expect(await findPrimaryCalendar()).toBe(`${ACCOUNT.uuid}_calendar`)
  })

  it('falls back to the internal calendar when no calendars are available', async () => {
    expect(await findPrimaryCalendar()).toBe(`${ACCOUNT.uuid}_calendar`)
  })
})
