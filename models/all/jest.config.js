module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ["./src"],
  globals: { localStorage: {} },
  moduleNameMapper: {
    '^svelte/store$': '<rootDir>/node_modules/@hcengineering/view-resources/src/__mocks__/svelte-store.ts',
    '\\.svelte$': '<rootDir>/src/__mocks__/svelte-component.ts'
  },
  coverageReporters: ["text-summary", "html"]
}
