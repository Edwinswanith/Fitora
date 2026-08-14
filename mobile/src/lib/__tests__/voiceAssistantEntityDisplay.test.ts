import { formatEntitiesForDisplay } from "../voiceAssistant/entityDisplay";

describe("formatEntitiesForDisplay", () => {
  test("uses a friendly label and unit-formatted value for known fields", () => {
    const rows = formatEntitiesForDisplay({ actualDurationMin: 45, amountMl: 500, plannedIntensityPercent: 80 });
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: "actualDurationMin", label: "Duration", value: "45 min" },
        { key: "amountMl", label: "Amount", value: "500 ml" },
        { key: "plannedIntensityPercent", label: "Planned intensity", value: "80%" },
      ])
    );
  });

  test("falls back to the raw key as the label for anything unmapped", () => {
    const rows = formatEntitiesForDisplay({ someNewField: "x" });
    expect(rows).toEqual([{ key: "someNewField", label: "someNewField", value: "x" }]);
  });

  test("drops undefined/null/empty-string entities entirely, never shows a blank row", () => {
    const rows = formatEntitiesForDisplay({ notes: undefined, body: null, workoutType: "" , status: "completed" });
    expect(rows).toEqual([{ key: "status", label: "Status", value: "completed" }]);
  });

  test("formats booleans and arrays readably", () => {
    const rows = formatEntitiesForDisplay({ enabled: true, modalities: ["stretching", "ice_bath"] });
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: "enabled", label: "Enabled", value: "Yes" },
        { key: "modalities", label: "Modalities", value: "stretching, ice_bath" },
      ])
    );
  });
});
