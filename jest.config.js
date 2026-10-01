/**
 * Jest is run with --experimental-vm-modules because this package is ESM
 * ("type": "module"); see the test scripts in package.json.
 */
export default {
  testEnvironment: 'node',
  // Serial execution. Three suites each start a MongoMemoryServer, and in
  // parallel workers they race to download and lock the same mongod binary
  // in ~/.cache/mongodb-binaries -- which fails on a cold CI runner with
  // UnableToUnlockLockfileError. Running in band makes the download happen
  // once. The suite takes a few seconds, so there is nothing to gain from
  // parallelism here.
  maxWorkers: 1,
  testMatch: ['**/tests/**/*.test.js'],
  // Runs before any module under test is imported. Several modules fail
  // closed at import time without their secrets, which is intended
  // behaviour, so the tests supply ephemeral values.
  setupFiles: ['<rootDir>/tests/setup.js'],
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
