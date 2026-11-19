module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleNameMapper: {
    '^@hcengineering/presentation$': '<rootDir>/../../packages/presentation/src/pipeline',
    '^@hcengineering/view-resources$': '<rootDir>/../view-resources/src/middleware',
    '\\.svelte$': '<rootDir>/src/__mocks__/svelte-component.ts'
  }
}
