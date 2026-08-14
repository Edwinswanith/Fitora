import "express-async-errors";
import express from "express";
import request from "supertest";
import { errorHandler } from "../src/middleware/errorHandler";

/**
 * Builds a throwaway app whose only route throws, followed by the global error
 * middleware. Mirrors how index.ts wires the handler as the final `app.use`.
 */
function buildAppThatThrows(thrower: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.get("/boom", thrower);
  app.use(errorHandler);
  return app;
}

describe("global error middleware", () => {
  test("unexpected synchronous throw → 500 { error: server_error }", async () => {
    const app = buildAppThatThrows(() => {
      throw new Error("kaboom");
    });
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "server_error" });
  });

  test("unexpected async throw → 500 { error: server_error }", async () => {
    // Async rejection is caught via express-async-errors, same as real routes.
    const app = buildAppThatThrows(async () => {
      await Promise.resolve();
      throw new Error("async kaboom");
    });
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "server_error" });
  });

  test("500 response never leaks the underlying error message", async () => {
    const app = buildAppThatThrows(() => {
      throw new Error("super secret stack detail");
    });
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("super secret");
  });

  test("errors carrying an explicit 4xx status are preserved, not masked as 500", async () => {
    const app = buildAppThatThrows(() => {
      const err = new Error("invalid_thing") as Error & { status?: number };
      err.status = 400;
      throw err;
    });
    const res = await request(app).get("/boom");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_thing" });
  });
});
