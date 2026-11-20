module.exports = {
  preset: 'ts-jest',
  moduleNameMapper: { '^@hcengineering/safe-fetch$': '<rootDir>/../../../packages/safe-fetch/src/index.ts' },
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ["./src"],
  coverageReporters: ["text-summary", "html"]
}
