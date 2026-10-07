import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope } from "../middleware/coachAthleteAccess";
import {
  JoinRequestError,
  cancelJoinRequest,
  createJoinRequest,
  decideJoinRequest,
  latestJoinRequestForAthlete,
  pendingJoinRequestsForCoach,
  serializeJoinRequests,
} from "../services/coachJoinRequest";

function sendError(res: Response, err: unknown): void {
  if (err instanceof JoinRequestError) return void res.status(err.status).json({ error: err.message });
  throw err;
}

// ── Athlete: ask a coach, see the status, withdraw ─────────────────────────
export const athleteJoinRequestsRouter = Router();
athleteJoinRequestsRouter.use(requireAuth, requireRole("athlete"), loadScope);

/** POST /api/athlete/coaches/:coachId/join-request  body: { message? } */
athleteJoinRequestsRouter.post(
  "/coaches/:coachId/join-request",
  writeRateLimit({ windowMs: 60_000, max: 10 }),
  async (req: Request, res: Response) => {
    const athleteId = req.actor?.athleteProfileId;
    if (!req.actor || !athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });
    try {
      const request = await createJoinRequest({ athleteId, athleteUserId: req.actor.userId, coachId: req.params.coachId, message: req.body?.message });
      const [view] = await serializeJoinRequests([request.toObject()]);
      res.status(201).json({ request: view });
    } catch (err) {
      sendError(res, err);
    }
  }
);

/** GET /api/athlete/join-request: the pending request, else the latest decided one, else null. */
athleteJoinRequestsRouter.get("/join-request", async (req: Request, res: Response) => {
  const athleteId = req.actor?.athleteProfileId;
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  const latest = await latestJoinRequestForAthlete(athleteId);
  const [view] = latest ? await serializeJoinRequests([latest]) : [null];
  res.json({ request: view ?? null });
});

/** POST /api/athlete/join-request/:requestId/cancel */
athleteJoinRequestsRouter.post(
  "/join-request/:requestId/cancel",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  async (req: Request, res: Response) => {
    const athleteId = req.actor?.athleteProfileId;
    if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });
    try {
      const updated = await cancelJoinRequest(athleteId, req.params.requestId);
      const [view] = await serializeJoinRequests([updated]);
      res.json({ request: view });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── Coach: see who asked, accept or decline ────────────────────────────────
export const coachJoinRequestsRouter = Router();
coachJoinRequestsRouter.use(requireAuth, requireRole("coach"), loadScope);

/** GET /api/coach/join-requests: pending requests addressed to this coach only. */
coachJoinRequestsRouter.get("/join-requests", async (req: Request, res: Response) => {
  const rows = await pendingJoinRequestsForCoach(req.actor!.userId);
  res.json({ requests: await serializeJoinRequests(rows) });
});

for (const decision of ["accept", "decline"] as const) {
  /** POST /api/coach/join-requests/:requestId/accept | /decline */
  coachJoinRequestsRouter.post(
    `/join-requests/:requestId/${decision}`,
    writeRateLimit({ windowMs: 60_000, max: 40 }),
    async (req: Request, res: Response) => {
      try {
        const updated = await decideJoinRequest({
          coachId: req.actor!.userId,
          coachAcademyId: req.actor!.academyId ?? null,
          requestId: req.params.requestId,
          decision,
        });
        const [view] = await serializeJoinRequests([updated]);
        res.json({ request: view });
      } catch (err) {
        sendError(res, err);
      }
    }
  );
}
