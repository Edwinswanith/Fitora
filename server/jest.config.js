/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  testTimeout: 300000,
  setupFiles: ["<rootDir>/tests/env-setup.ts"],
  globalTeardown: "<rootDir>/tests/global-teardown.ts",
};
