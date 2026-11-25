module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.(svelte|js)$': '<rootDir>/../../packages/presentation/src/__tests__/svelte-transformer.cjs'
  },
  transformIgnorePatterns: ['/node_modules/(?!svelte/|\\.pnpm/svelte@)'],
  moduleNameMapper: {
    '^@hcengineering/text$': '<rootDir>/../../foundations/core/packages/text-core/src/index.ts'
  }
}
