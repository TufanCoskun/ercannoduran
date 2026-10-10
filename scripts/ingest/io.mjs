// Shared helpers for ingestion scripts: paths, args, JSON IO, atomic writes, HTTP.
// Plain Node 22 ESM, zero dependencies.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = resolve(ROOT, "data");
export const ADS_DIR = resolve(DATA_DIR, "ads");
export const BRANDS_FILE = resolve(DATA_DIR, "brands.json");

/** True when the given module is the entry point (`node file.mjs`). */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

/**
 * Minimal argv parser: --flag, --key=value, --key value. Positional args in `_`.
 * Boolean flags listed in `booleans` never consume the next token.
 */
export function parseArgs(argv = process.argv.slice(2), booleans = ["dry-run", "help", "verbose"]) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (booleans.includes(key) || next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

/** Write JSON atomically (tmp file + rename) so concurrent readers never see half a file. */
export async function writeJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

export async function loadBrands() {
  const brands = await readJson(BRANDS_FILE, []);
  if (!Array.isArray(brands)) throw new Error(`${BRANDS_FILE} must be a JSON array`);
  return brands;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout + JSON parse; never throws on HTTP status, returns {ok,status,json,text}. */
export async function fetchJson(url, init = {}, timeoutMs = 30_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

export const log = (...a) => console.error(...a); // logs go to stderr so --dry-run stdout stays valid JSON
