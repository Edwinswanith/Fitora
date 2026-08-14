/**
 * Production bootstrap: create a SINGLE clean academy + owner-coach account and
 * nothing else (no demo athletes, no fake history). This is the proper way to
 * hand a fresh deployment to a real client — they sign in as the owner-coach and
 * provision their own coaches/athletes in-app.
 *
 * All values come from env so credentials are never committed:
 *   ACADEMY_NAME   e.g. "Velocity Track Club"
 *   OWNER_NAME     e.g. "Jane Doe"
 *   OWNER_EMAIL    e.g. "jane@velocity.club"   (this is the login)
 *   OWNER_PASSWORD the owner's private password
 *   ACADEMY_TIMEZONE  optional, defaults to "Asia/Kolkata"
 *
 * Idempotent: re-running updates the same academy (by slug) and owner (by email)
 * rather than duplicating. It does NOT touch any other data.
 */
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { Academy } from "../models/Academy";
import { User } from "../models/User";

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function run() {
  const academyName = req("ACADEMY_NAME");
  const ownerName = req("OWNER_NAME");
  const ownerEmail = req("OWNER_EMAIL").toLowerCase();
  const ownerPassword = req("OWNER_PASSWORD");
  const timezone = process.env.ACADEMY_TIMEZONE?.trim() || "Asia/Kolkata";

  if (ownerPassword.length < 8) {
    throw new Error("OWNER_PASSWORD must be at least 8 characters.");
  }

  await connectMongo();
  if (mongoose.connection.readyState !== 1) throw new Error("Mongo not connected");
  console.log("[bootstrap] connected to db:", mongoose.connection.db?.databaseName);

  const slug = slugify(academyName) || "academy";
  const academy = await Academy.findOneAndUpdate(
    { slug },
    { $set: { name: academyName, slug, timezone, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  const owner = await User.findOneAndUpdate(
    { email: ownerEmail },
    {
      $set: {
        email: ownerEmail,
        role: "coach",
        name: ownerName,
        passwordHash,
        academyId: academy._id,
        isActive: true,
        isAcademyOwner: true,
        mustChangePassword: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log("[bootstrap] academy:", { name: academy.name, slug: academy.slug, id: String(academy._id) });
  console.log("[bootstrap] owner-coach:", {
    name: owner.name,
    email: owner.email,
    isAcademyOwner: owner.isAcademyOwner,
    id: String(owner._id),
  });
  console.log("[bootstrap] total users in db:", await User.countDocuments());
}

run()
  .then(async () => {
    await disconnectMongo();
    console.log("[bootstrap] done");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[bootstrap] failed:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
