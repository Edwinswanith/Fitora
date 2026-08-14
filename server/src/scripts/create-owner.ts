import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { Academy } from "../models/Academy";
import { User } from "../models/User";
import { generateTempPassword } from "../lib/tempPassword";

/**
 * Bootstrap the FIRST academy-owner coach.
 *
 * There is no admin and no self-signup (see CLAUDE.md), so after wiping the
 * database nobody can log in and therefore nobody can create the first coach
 * through the app. This script plants that first owner directly in Mongo. Once
 * the owner exists, everything else cascades in-app:
 *
 *   owner → creates coaches (POST /api/coach/coaches)
 *   coach → creates athletes + guardians (POST /api/coach/athletes …)
 *
 * Usage (from repo root):
 *   npm run create-owner --workspace server -- \
 *     --email owner@club.com --name "Jane Doe" --academy "My Academy" [--password 'Secret123']
 *
 * Or via env vars: OWNER_EMAIL, OWNER_NAME, OWNER_ACADEMY, OWNER_PASSWORD.
 *
 * Idempotent: re-running with the same email promotes/updates that user to an
 * owner rather than creating a duplicate. A new password is only set when one is
 * supplied (or the user is brand new); an existing user's password is untouched
 * unless --password is given.
 */

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1].trim();
  return undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "academy"
  );
}

async function run() {
  const email = (flag("email") ?? process.env.OWNER_EMAIL ?? "").toLowerCase().trim();
  const name = flag("name") ?? process.env.OWNER_NAME ?? "";
  const academyName = flag("academy") ?? process.env.OWNER_ACADEMY ?? "";
  const providedPassword = flag("password") ?? process.env.OWNER_PASSWORD ?? "";

  if (!EMAIL_RE.test(email)) {
    throw new Error("Missing/invalid --email (or OWNER_EMAIL).");
  }
  if (!name) {
    throw new Error("Missing --name (or OWNER_NAME).");
  }

  await connectMongo();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Mongo not connected");
  }
  console.log("[create-owner] connected to", mongoose.connection.db?.databaseName);

  // Resolve the academy (optional). If a name is given, upsert it so the owner
  // and the coaches/athletes they create are all tagged to the same academy.
  let academyId: mongoose.Types.ObjectId | undefined;
  if (academyName) {
    const academy = await Academy.findOneAndUpdate(
      { slug: slugify(academyName) },
      {
        $set: { name: academyName, slug: slugify(academyName), isActive: true },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    academyId = academy._id;
    console.log(`[create-owner] academy: ${academy.name} (${academy.slug})`);
  }

  const existing = await User.findOne({ email });

  if (existing) {
    const update: Record<string, unknown> = {
      role: "coach",
      isAcademyOwner: true,
      isActive: true,
    };
    if (academyId) update.academyId = academyId;

    let newPassword: string | undefined;
    if (providedPassword) {
      newPassword = providedPassword;
      update.passwordHash = await bcrypt.hash(providedPassword, 10);
      update.mustChangePassword = true;
    }
    await User.updateOne({ _id: existing._id }, { $set: update });

    console.log("\n[create-owner] ✓ Existing user promoted to academy owner.");
    console.log(`  email:    ${email}`);
    console.log(`  name:     ${existing.name}`);
    if (newPassword) console.log(`  password: ${newPassword}  (must change on first login)`);
    else console.log("  password: (unchanged — pass --password to reset it)");
    return;
  }

  const password = providedPassword || generateTempPassword();
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    email,
    name,
    passwordHash,
    role: "coach",
    isAcademyOwner: true,
    isActive: true,
    mustChangePassword: true,
    academyId,
  });

  console.log("\n[create-owner] ✓ First academy owner created.");
  console.log(`  email:    ${email}`);
  console.log(`  name:     ${name}`);
  console.log(`  password: ${password}  (must change on first login)`);
  console.log("\nLog in at the coach login, then add coaches via the owner UI.");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[create-owner] failed:", (err as Error).message);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
