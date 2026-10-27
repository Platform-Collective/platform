module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleNameMapper: {
    // Exercise the production resolver without loading the Svelte component registry.
    '^@hcengineering/view-resources$': '<rootDir>/../view-resources/src/filter.ts',
    '^svelte/store$': '<rootDir>/../view-resources/src/__mocks__/svelte-store.ts'
  }
}
