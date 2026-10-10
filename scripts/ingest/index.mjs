#!/usr/bin/env node
// Runs every ingestion source in order (Meta, then TikTok) and prints a summary.
//
//   node scripts/ingest/index.mjs [--dry-run] [--only meta|tiktok] [...source options]
//
// A source whose credentials are missing is skipped with a clear message; the run still
// succeeds (exit 0) so a scheduled job does not fail just because one token is absent.
import { log, parseArgs } from "./io.mjs";
import { run as runMeta } from "./meta.mjs";
import { run as runTikTok } from "./tiktok.mjs";

const args = parseArgs(process.argv.slice(2), ["dry-run", "help", "verbose", "no-filter"]);
if (args.help) {
  console.log(`Kullanım: node scripts/ingest/index.mjs [--dry-run] [--only meta|tiktok]
  Meta   : META_AD_LIBRARY_TOKEN gerekli (opsiyonel: --market TR|US, --limit-per-brand N, --brand NAME)
  TikTok : TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET (AB kapsamı) ve/veya --import FILE --market TR|US|GLOBAL, --urls FILE`);
  process.exit(0);
}

const sources = [
  ["meta", runMeta],
  ["tiktok", runTikTok],
].filter(([name]) => !args.only || args.only === name);

const started = Date.now();
const results = [];
for (const [name, run] of sources) {
  log(`\n=== ${name.toUpperCase()} ===`);
  try {
    results.push(await run(args));
  } catch (e) {
    log(`[${name}] HATA: ${e.message}`);
    results.push({ source: name, status: "error", message: e.message });
  }
}

const line = (s) => {
  if (s.source === "meta" && s.markets && Object.keys(s.markets).length) {
    return Object.entries(s.markets)
      .map(([m, x]) => `meta-${m.toLowerCase()}: çekilen ${x.fetched}, +${x.added} yeni, ~${x.updated} güncel, toplam ${x.ads}${x.errors ? `, ${x.errors} hata` : ""}`)
      .join(" | ");
  }
  if (s.source === "tiktok" && s.total !== undefined) return `tiktok: gelen ${s.incoming}, +${s.added} yeni, ~${s.updated} güncel, toplam ${s.total}`;
  return s.message || "";
};

log(`\n=== ÖZET${args["dry-run"] ? " (dry-run, dosya yazılmadı)" : ""} — ${((Date.now() - started) / 1000).toFixed(1)} sn ===`);
for (const s of results) log(`  ${s.source.padEnd(7)} ${String(s.status).toUpperCase().padEnd(8)} ${line(s)}`);
if (results.some((s) => s.status === "error")) process.exitCode = 1;
