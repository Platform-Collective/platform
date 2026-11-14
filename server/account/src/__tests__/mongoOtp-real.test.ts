import { generateUuid, SocialIdType, type PersonId } from '@hcengineering/core'
import { MongoClient, type Db } from 'mongodb'
import { MongoAccountDB } from '../collections/mongo'
import { otpCooldownCases } from './otpCooldownCases'

jest.setTimeout(90000)

describe('real MongoDB OTP cooldown transition', () => {
  const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27018')
  const socialId = 'legacy-email' as PersonId
  let database: Db
  let account: MongoAccountDB

  beforeAll(async () => {
    await client.connect()
  })

  beforeEach(async () => {
    database = client.db(`account_otp_transition_${generateUuid().replace(/-/g, '')}`)
    account = new MongoAccountDB(database)
    await database.collection<{ _id: PersonId, type: SocialIdType, value: string }>('socialId').insertOne({
      _id: socialId,
      type: SocialIdType.EMAIL,
      value: 'otp-transition@example.com'
    })
  })

  afterEach(async () => {
    await database.dropDatabase()
  })

  afterAll(async () => {
    await client.close()
  })

  otpCooldownCases(
    () => account,
    async () => socialId,
    async () => {
      const row = await database
        .collection('socialId')
        .aggregate<{ now: number }>([
          { $match: { _id: socialId } },
          { $project: { now: { $toLong: '$$NOW' } } }
        ])
        .next()
      if (row == null) throw new Error('Missing test identity')
      return row.now
    }
  )
})
