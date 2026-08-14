import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { writeRateLimit } from "../middleware/rateLimit";
import { getTourNarrator } from "../services/tourNarrator";

/**
 * AI-narrated app-tour endpoint — the guided tour runs identically on every
 * role's dashboard, so this lives in its own router gated only by
 * `requireAuth`, matching routes/avatar.ts, rather than being duplicated
 * across the three role routers.
 */
const router = Router();
router.use(requireAuth);

/** POST /api/tour/narrate — rephrases one tour step's static copy via the AI agent persona. */
router.post(
  "/narrate",
  writeRateLimit({ windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const { stepId, title, fallbackNote, context } = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof stepId !== "string" ||
      !stepId.trim() ||
      typeof title !== "string" ||
      !title.trim() ||
      typeof fallbackNote !== "string" ||
      !fallbackNote.trim()
    ) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    try {
      const result = await getTourNarrator().narrate({
        role: req.actor.role,
        stepId,
        title,
        fallbackNote,
        context: context && typeof context === "object" ? (context as Record<string, unknown>) : undefined,
      });
      res.json(result);
    } catch {
      // The tour must never break the app — fall back to the static copy.
      res.json({ note: fallbackNote });
    }
  }
);

export default router;
