module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.(js|svelte)$': '<rootDir>/svelte-jest-transformer.js'
  },
  transformIgnorePatterns: ['node_modules/(?!(?:\\.pnpm/)?svelte(?:/|@))'],
  moduleNameMapper: {
    '^@hcengineering/text$': '<rootDir>/src/__tests__/fixtures/text-stub.ts',
    '^\\./(?:TagReferencePresenter|TagItem|TagsReferencePresenter|TagsItemPresenter)\\.svelte$':
      '<rootDir>/src/__tests__/fixtures/TagReferenceStub.svelte'
  }
}
