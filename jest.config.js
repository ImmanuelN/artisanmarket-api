/**
 * Jest is run with --experimental-vm-modules because this package is ESM
 * ("type": "module"); see the test scripts in package.json.
 */
export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Coverage is reported for application code only. Config, entrypoints and
  // model definitions are excluded: they are declarative or require a live
  // database, and counting them would understate coverage of the code that
  // actually makes decisions.
  collectCoverageFrom: [
    'utils/**/*.js',
    'middleware/**/*.js',
    'routes/**/*.js',
    '!**/node_modules/**'
  ],
  coverageReporters: ['text-summary', 'lcov'],
  coverageDirectory: 'coverage'
}
