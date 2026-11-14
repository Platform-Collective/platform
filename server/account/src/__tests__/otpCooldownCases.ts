import type { PersonId } from '@hcengineering/core'
import type { AccountDB } from '../types'

// Register inside a real DB fixture; no adapter mocks. Deliberately long deadlines avoid sleeps.
export function otpCooldownCases (
  getDb: () => AccountDB,
  getSocialId: () => Promise<PersonId>,
  getNow: () => Promise<number>
): void {
  it.each([false, true])(
    'preserves an observed legacy deadline across consumption (prior writer: %s)',
    async (prior) => {
      const db = getDb()
      const socialId = await getSocialId()
      if (prior) await db.reserveOtpSend(socialId, 0)
      const now = await getNow()
      // An old writer inserts without updating otpRetryOn, even after a new writer has run.
      await db.otp.insertOne({ socialId, code: '234567', createdOn: now, expiresOn: now + 120000 })
      const result = await db.reserveOtpSend(socialId, 60000)
      expect(result.reserved).toBe(false)
      expect(result.retryOn).toBe(now + 60000)
      expect(await db.otp.deleteMany({ socialId, code: '234567' })).toBe(1)
      const afterConsume = await db.reserveOtpSend(socialId, 60000)
      expect(afterConsume.reserved).toBe(false)
      expect(afterConsume.retryOn).toBe(now + 60000)

      // Document the incompatible old caller: no OTP means its send predicate permits mail.
      // A storage adapter cannot stop that caller's mail-before-insert side effect.
      expect(await db.otp.find({ socialId })).toHaveLength(0)
    }
  )

  it('does not extend a legacy deadline beyond the OTP expiry', async () => {
    const db = getDb()
    const socialId = await getSocialId()
    const now = await getNow()
    await db.otp.insertOne({ socialId, code: '234567', createdOn: now, expiresOn: now + 30000 })
    const result = await db.reserveOtpSend(socialId, 60000)
    expect(result.reserved).toBe(false)
    expect(result.retryOn).toBe(now + 30000)
  })

  it('does not shorten a persistent reservation when a legacy writer inserts', async () => {
    const db = getDb()
    const socialId = await getSocialId()
    const reserved = await db.reserveOtpSend(socialId, 120000)
    expect(reserved.reserved).toBe(true)
    const now = await getNow()
    await db.otp.insertOne({ socialId, code: '234567', createdOn: now - 30000, expiresOn: now + 60000 })
    const result = await db.reserveOtpSend(socialId, 60000)
    expect(result.reserved).toBe(false)
    expect(result.retryOn).toBe(reserved.retryOn)
  })

  it('ignores expired legacy OTPs and reserves atomically between new writers', async () => {
    const db = getDb()
    const socialId = await getSocialId()
    const now = await getNow()
    await db.otp.insertOne({ socialId, code: '234567', createdOn: now - 60000, expiresOn: now - 1 })
    const results = await Promise.all(Array.from({ length: 4 }, async () => await db.reserveOtpSend(socialId, 60000)))
    expect(results.filter((result) => result.reserved)).toHaveLength(1)
    expect(new Set(results.map((result) => result.retryOn)).size).toBe(1)
  })
}
