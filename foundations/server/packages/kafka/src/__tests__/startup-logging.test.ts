// SPDX-License-Identifier: EPL-2.0
import { createPlatformQueue } from '..'
jest.mock('kafkajs', () => ({ Kafka: jest.fn(() => ({})) }))
it('does not log TLS private keys or passphrases', () => {
  const canary = 'synthetic-tls-credential'
  const info = jest.spyOn(console, 'info').mockImplementation(() => {})
  try {
    createPlatformQueue({
      brokers: ['localhost:9092'],
      clientId: 'test',
      postfix: '',
      region: '',
      ssl: { key: canary, passphrase: canary }
    })
    expect(JSON.stringify(info.mock.calls).includes(canary)).toBe(false)
    expect(info.mock.calls.length).toBe(1)
  } finally {
    info.mockRestore()
  }
})
