module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ["./src"],
  // svelte/store ships as ESM, which the CommonJS test runtime cannot require
  moduleNameMapper: {
    '^svelte/store$': '<rootDir>/src/__mocks__/svelte-store.ts'
  },
  coverageReporters: ["text-summary", "html"]
}
