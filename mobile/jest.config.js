/**
 * Covers only the pure (no React/Expo import) modules under src/lib — the
 * screens themselves have no test suite (see CLAUDE.md), but logic that's
 * plain TypeScript is worth unit testing directly without a full RN harness.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/lib/**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
};
