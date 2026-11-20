module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleNameMapper: {
    '^svelte/store$': '<rootDir>/src/__mocks__/svelte-store.ts'
  }
}
