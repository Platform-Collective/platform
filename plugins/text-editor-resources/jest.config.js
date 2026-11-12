const SVELTE_MOCKS = require('path').join(
  __dirname,
  '../../packages/presentation/src/__mocks__'
)

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  // Reuses the stub packages/presentation already maintains and desktop already borrows,
  // rather than adding a third copy. Lets a plain-TS module that happens to import a .svelte
  // icon be tested without a component harness.
  moduleNameMapper: {
    '\\.svelte$': `${SVELTE_MOCKS}/svelte-component.ts`
  }
}
