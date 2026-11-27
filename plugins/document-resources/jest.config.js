module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '(?:\\.svelte|/svelte/src/.*\\.js)$': '<rootDir>/jest-svelte-transform.cjs'
  },
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/|svelte/)'],
  roots: ['./src'],
  coverageReporters: ['text-summary', 'html']
}
