module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ['./src'],
  moduleNameMapper: {
    '^tus-js-client$': '<rootDir>/node_modules/tus-js-client/lib.es5/browser/index.js',
    '^svelte/store$': '<rootDir>/node_modules/svelte/src/runtime/store/index.js'
  },
  transformIgnorePatterns: ['/node_modules/(?!.*svelte/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: { allowJs: true, isolatedModules: true } }]
  },
  coverageReporters: ['text-summary', 'html']
}
