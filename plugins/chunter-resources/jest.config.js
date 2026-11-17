module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  // channelDataProvider.ts imports `svelte/store`, which ships as ESM and cannot be
  // required under the ts-jest CommonJS runtime. Map it to a local stand-in,
  // mirroring the @hcengineering/presentation package.
  moduleNameMapper: {
    '^svelte/store$': '<rootDir>/src/__mocks__/svelte-store.ts'
  }
}
