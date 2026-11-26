module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.(svelte|js)$': '<rootDir>/test/svelte-transformer.cjs'
  },
  transformIgnorePatterns: ['/node_modules/(?!svelte/|\\.pnpm/svelte@)']
}
