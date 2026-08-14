import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function removePath(path) {
  if (!existsSync(path)) return;
  rmSync(path, { force: true, recursive: !lstatSync(path).isSymbolicLink() });
}

const mobileDir = resolve(root, "mobile");
const exportDir = resolve(mobileDir, "dist");
const publicDir = resolve(root, "public");
const privacyPolicy = resolve(root, "legal/privacy.html");
const deleteAccountPolicy = resolve(root, "legal/delete-account.html");
const supportPage = resolve(root, "legal/support.html");
const pagesLink = resolve(root, "pages");
const nextConfig = resolve(root, "next.config.js");

removePath(exportDir);
run("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist"], {
  cwd: mobileDir,
  env: {
    EXPO_PUBLIC_API_URL: "",
    EXPO_PUBLIC_API_BASE_URL: "",
  },
});

removePath(publicDir);
mkdirSync(publicDir, { recursive: true });
cpSync(exportDir, publicDir, { recursive: true });
cpSync(privacyPolicy, resolve(publicDir, "privacy.html"));
cpSync(deleteAccountPolicy, resolve(publicDir, "delete-account.html"));
cpSync(supportPage, resolve(publicDir, "support.html"));

removePath(pagesLink);
symlinkSync("backend/pages", pagesLink, "dir");

cpSync(resolve(root, "backend/next.config.vercel.js"), nextConfig);

run("npx", ["next", "build"], { cwd: root });
