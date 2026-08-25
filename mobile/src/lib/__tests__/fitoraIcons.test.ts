import { activityVisual, exerciseVisual, mealVisual, planVisual, workoutVisual } from "../fitoraIcons";

describe("fitora icon mapping", () => {
  it("uses named artwork for supported exercise previews", () => {
    expect(exerciseVisual("Bench Press").asset).toBe("bench");
    expect(exerciseVisual("Lat Pulldown").asset).toBe("pulldown");
    expect(exerciseVisual("Shoulder Press").asset).toBe("shoulder");
    expect(exerciseVisual("Lateral Raise").asset).toBe("shoulder");
    expect(exerciseVisual("Push-ups").asset).toBeUndefined();
  });

  it("maps workout names to their content family", () => {
    expect(workoutVisual("Upper Body Strength").asset).toBe("torso");
    expect(workoutVisual("Recovery Mobility").icon).toBe("accessibility-outline");
    expect(workoutVisual("Cardio Intervals").icon).toBe("pulse-outline");
    expect(workoutVisual("Lower Body").icon).toBe("walk-outline");
  });

  it("maps plan and meal rows from names and types", () => {
    expect(planVisual("High Protein Meal Plan").icon).toBe("restaurant-outline");
    expect(planVisual("Quick Tasks").icon).toBe("checkbox-outline");
    expect(planVisual("14-Day Fitness Routine").icon).toBe("repeat-outline");
    expect(mealVisual("breakfast").icon).toBe("sunny-outline");
  });

  it("maps activity rows from their event kind", () => {
    expect(activityVisual("payment_failed", "Membership payment failed").icon).toBe("card-outline");
    expect(activityVisual("meal_logged", "Logged lunch").icon).toBe("restaurant-outline");
    expect(activityVisual("water_logged", "Added water").icon).toBe("water-outline");
    expect(activityVisual("video_watched", "Watched Squat Tutorial").icon).toBe("play-circle-outline");
    expect(activityVisual("coach_note", "Coach sent a note").icon).toBe("chatbubble-outline");
  });
});
