module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  // workbench.ts imports `svelte/store`, which ships as ESM and cannot be required
  // under the ts-jest CommonJS runtime. Map it to the shared stand-in.
  moduleNameMapper: {
    '^svelte/store$': '<rootDir>/../../packages/presentation/src/__mocks__/svelte-store.ts'
  }
}
