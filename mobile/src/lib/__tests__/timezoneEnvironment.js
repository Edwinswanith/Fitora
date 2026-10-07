/**
 * Jest environment for timezone tests: the stock node environment plus a
 * `__setTimeZone(zone)` global. Tests can't change the zone themselves
 * (`process.env` inside a test is a sandboxed copy), but this file runs in the
 * real process, where assigning process.env.TZ re-configures V8's clock zone
 * for every Date, including the test sandbox's. The original zone is put back
 * on teardown so other suites in the same worker are unaffected.
 *
 * Use with a docblock at the top of a test file:
 *   @jest-environment ./src/lib/__tests__/timezoneEnvironment.js
 */
const { TestEnvironment } = require("jest-environment-node");

class TimezoneEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.originalTimeZone = process.env.TZ;
    this.global.__setTimeZone = (zone) => {
      process.env.TZ = zone;
    };
  }

  async teardown() {
    if (this.originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = this.originalTimeZone;
    await super.teardown();
  }
}

module.exports = TimezoneEnvironment;
