import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tauriDir = path.join(repoRoot, "src-tauri");

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(cmd, args, { cwd, env } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (res.error) throw res.error;
  if (typeof res.status === "number" && res.status !== 0) {
    die(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  }
}

function parseVersionArg() {
  const v = process.argv[2];
  if (!v) {
    die(
      "Missing version. Usage: vp run release:prep -- <newVersion|patch|minor|major>\nExamples:\n  vp run release:prep -- 0.1.7\n  vp run release:prep -- patch",
    );
  }
  // Basic semver (allows prerelease/build too).
  const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (v === "patch" || v === "minor" || v === "major") return v;
  if (!semver.test(v)) die(`Invalid version: ${v}`);
  return v;
}

function bumpSemver(baseVersion, bumpKind) {
  const m = baseVersion.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/);
  if (!m) die(`Current version is not plain semver: ${baseVersion}`);
  let [major, minor, patch] = m.slice(1).map((n) => Number.parseInt(n, 10));
  if (bumpKind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpKind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

async function bumpPackageJson(version) {
  const p = path.join(repoRoot, "package.json");
  const raw = await readFile(p, "utf8");
  const json = JSON.parse(raw);
  json.version = version;
  await writeFile(p, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

async function bumpTauriConf(version) {
  const p = path.join(tauriDir, "tauri.conf.json");
  const raw = await readFile(p, "utf8");
  const json = JSON.parse(raw);
  json.version = version;
  await writeFile(p, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

async function bumpCargoToml(version) {
  const p = path.join(tauriDir, "Cargo.toml");
  const raw = await readFile(p, "utf8");

  const pkgIdx = raw.search(/^\[package\]\s*$/m);
  if (pkgIdx === -1) die("Could not find [package] section in src-tauri/Cargo.toml");

  // Replace the first `version = "..."` after [package]
  const afterPkg = raw.slice(pkgIdx);
  const replaced = afterPkg.replace(/^version\s*=\s*"[^"]*"\s*$/m, `version = "${version}"`);
  if (replaced === afterPkg) {
    die('Could not find `version = "..."` in [package] section of src-tauri/Cargo.toml');
  }

  await writeFile(p, raw.slice(0, pkgIdx) + replaced, "utf8");
}

async function main() {
  const arg = parseVersionArg();
  let version = arg;
  if (arg === "patch" || arg === "minor" || arg === "major") {
    const pkgRaw = await readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    version = bumpSemver(pkg.version, arg);
    process.stdout.write(`Bumping ${pkg.version} -> ${version}\n`);
  }

  await bumpPackageJson(version);
  await bumpTauriConf(version);
  await bumpCargoToml(version);

  // Refresh Cargo.lock without compiling.
  run("cargo", ["generate-lockfile"], { cwd: tauriDir });

  // Generate/update CHANGELOG.md using the same script CI runs, but pin VERSION.
  run("vp", ["run", "changelog"], {
    env: { VERSION: version, CHANGELOG_INCLUDE_UNRELEASED: "" },
  });
}

await main();
