#!/usr/bin/env node
// Course Recap Generator - stage 1: PDF extraction via the configured MCP server.
//
// All PDF text comes from the `pdf-reader` MCP server (@rturv/mcp-pdf-reader) over stdio.
// This script owns only the project-specific cleaning rules from
// .opencode/skills/extract-course-concepts/SKILL.md §7.
//
//   node scripts/extract-pdf.mjs                # every PDF in input/
//   node scripts/extract-pdf.mjs --deck <slug>  # one deck
//   node scripts/extract-pdf.mjs --list         # list detected decks
//
// Dependency-free: Node built-ins only.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const INPUT_DIR = join(ROOT, "input");
const OUT_ROOT = join(ROOT, "extracted");
const EVIDENCE = join(ROOT, "evidence", "logs");

const MCP_PACKAGE = "@rturv/mcp-pdf-reader";
const MCP_NAME = "pdf-reader";
const TIMEOUT_MS = 120000;

// ---------------------------------------------------------------- CLI

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const d of listDecks()) console.log(`${d.slug}\t${d.file}`);
  process.exit(0);
}
const deckArg = argv.includes("--deck") ? argv[argv.indexOf("--deck") + 1] : null;

function listDecks() {
  if (!existsSync(INPUT_DIR)) return [];
  return readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => ({ slug: basename(f, ".pdf"), file: join(INPUT_DIR, f) }));
}

// ---------------------------------------------------------------- MCP client

class McpClient {
  constructor() {
    // Node cannot spawn a .cmd directly on Windows, and we avoid shell:true so the
    // stdio pipes stay clean. The command line is fully static - no user input.
    const cmd = `npx -y ${MCP_PACKAGE}`;
    const bin = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npx";
    const binArgs = process.platform === "win32" ? ["/d", "/s", "/c", cmd] : ["-y", MCP_PACKAGE];
    this.child = spawn(bin, binArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.pending = new Map();
    this.nextId = 1;
    this.buf = "";
    this.stderr = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => this.#onData(d));
    this.child.stderr.on("data", (d) => { this.stderr += d; });
    this.child.on("error", (e) => {
      for (const { reject } of this.pending.values()) reject(e);
      this.pending.clear();
    });
  }

  #onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => { this.pending.delete(id); reject(new Error(`timeout on ${method}`)); },
        TIMEOUT_MS
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize() {
    const res = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "course-recap-generator", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return res;
  }

  async call(name, args) {
    const res = await this.request("tools/call", { name, arguments: args });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    return text;
  }

  close() {
    try { this.child.kill(); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------- cleaning (§7)

const squash = (s) => String(s).replace(/\s+/g, " ").trim();

// A watermark is detected from the data, never from a hardcoded list (SKILL.md §7).
// Real decks put it on its own lines, so the test is persistence, not in-line repetition:
// a short token appearing on >= 40% of slides AND >= 3x per slide on average.
// Measured on this corpus: "deboistech" scores 25.0/slide (detected), while the most
// repeated content token "PART" scores 0.85/slide and page markers ~1.0 (both rejected).
function detectWatermark(pages) {
  const df = new Map();
  const total = new Map();
  for (const text of pages) {
    const seen = new Set();
    for (const tok of text.split(/\s+/).filter(Boolean)) {
      total.set(tok, (total.get(tok) || 0) + 1);
      seen.add(tok);
    }
    for (const tok of seen) df.set(tok, (df.get(tok) || 0) + 1);
  }
  const n = pages.length;
  const found = [];
  for (const [tok, count] of total) {
    if (!tok || tok.length > 32) continue;
    if ((df.get(tok) || 0) < n * 0.4) continue;
    if (count < n * 3) continue;
    found.push(tok);
  }
  return found.sort((a, b) => b.length - a.length);
}

// Running headings are reported for the manifest and used to split genuinely fused lines.
// Watermark fragments are excluded and HEADING_MIN_LEN stops a single letter from ever
// matching the start of a real line.
const HEADING_MIN_LEN = 8;

function detectHeadings(pages, watermark) {
  const wm = new Set(watermark);
  const counts = new Map();
  for (const text of pages) {
    const seen = new Set();
    for (const line of text.split(/\r?\n/)) {
      const s = squash(line);
      if (s.length < HEADING_MIN_LEN || s.length > 70) continue;
      if (!/^[\p{L}\p{N} ·—•#]+$/u.test(s)) continue;
      if (s.split(/\s+/).some((t) => wm.has(t))) continue;
      seen.add(s);
    }
    for (const s of seen) counts.set(s, (counts.get(s) || 0) + 1);
  }
  const threshold = Math.max(3, Math.floor(pages.length * 0.4));
  const found = [];
  for (const [s, n] of counts) if (n >= threshold) found.push(s);
  return found.sort((a, b) => b.length - a.length);
}

function cleanSlide(raw, watermark, headings) {
  const stats = { watermarkLines: 0, footerDropped: 0, markersDropped: 0, dupesCollapsed: 0, headingsSplit: 0 };
  const wm = new Set(watermark);

  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = squash(line);
    if (!s) continue;
    const toks = s.split(/\s+/).filter(Boolean);
    // Watermark-only line: every token is a detected fragment. A content line can never
    // match this, because a real word is not a fragment.
    if (toks.every((t) => wm.has(t))) { stats.watermarkLines++; continue; }
    if (/^[^·—]{2,40}\s[·—]\s*\d{4}-\d{2}-\d{2}$/.test(s)) { stats.footerDropped++; continue; }
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(s)) { stats.markersDropped++; continue; }
    if (/^\d+\)\s*=+$/.test(s)) { stats.markersDropped++; continue; }
    lines.push(s);
  }

  const deduped = [];
  for (const s of lines) {
    if (deduped.length && deduped[deduped.length - 1] === s) { stats.dupesCollapsed++; continue; }
    deduped.push(s);
  }

  const out = [];
  for (const s of deduped) {
    let split = false;
    for (const h of headings) {
      if (h.length >= HEADING_MIN_LEN && s.length > h.length + 8 && s.startsWith(h)) {
        out.push(h);
        out.push(squash(s.slice(h.length)));
        stats.headingsSplit++;
        split = true;
        break;
      }
    }
    if (!split) out.push(s);
  }

  return { lines: out, stats };
}

// ---------------------------------------------------------------- main

function logLine(lines, s) { lines.push(s); }

async function run() {
  const decks = deckArg ? listDecks().filter((d) => d.slug === deckArg) : listDecks();
  if (!decks.length) {
    console.error(deckArg ? `no deck matched --deck ${deckArg}` : `no PDFs found in ${INPUT_DIR}`);
    process.exit(1);
  }

  mkdirSync(EVIDENCE, { recursive: true });
  const log = [
    `course-recap-generator :: stage 1 PDF extraction`,
    `date:      ${new Date().toISOString()}`,
    `mcp:       ${MCP_NAME} (${MCP_PACKAGE}) over stdio`,
    `decks:     ${decks.length}`,
    "",
  ];

  const client = new McpClient();
  let init;
  try {
    init = await client.initialize();
    logLine(log, `server:    ${init.serverInfo.name} v${init.serverInfo.version} (protocol ${init.protocolVersion})`);
  } catch (e) {
    client.close();
    console.error(`FATAL: MCP server "${MCP_NAME}" failed to start: ${e.message}`);
    console.error(`Check .opencode/opencode.json and that 'npx -y ${MCP_PACKAGE}' runs.`);
    process.exit(1);
  }

  const results = [];
  for (const deck of decks) {
    logLine(log, `--- ${deck.slug} ---`);
    process.stdout.write(`\n${deck.slug}\n`);

    const pcText = await client.call("get_pdf_page_count", { filePath: deck.file });
    const total = parseInt((pcText.match(/(\d+)/) || [])[1] || "0", 10);
    if (!total) {
      logLine(log, `  ERROR: could not read page count`);
      results.push({ slug: deck.slug, ok: false, error: "no page count" });
      continue;
    }
    process.stdout.write(`  pages: ${total}\n`);

    const imagesText = await client.call("list_pdf_images", { filePath: deck.file }).catch(() => "");
    const imagesPerPage = new Map();
    for (const m of imagesText.matchAll(/"page"\s*:\s*(\d+)/g)) {
      const p = parseInt(m[1], 10);
      imagesPerPage.set(p, (imagesPerPage.get(p) || 0) + 1);
    }

    const rawPages = [];
    for (let n = 1; n <= total; n++) {
      rawPages.push(await client.call("read_pdf_pages", { filePath: deck.file, startPage: n }));
    }
    logLine(log, `  pages read:        ${rawPages.length}/${total}`);
    logLine(log, `  images reported:   ${imagesPerPage.size} pages carry images`);

    const watermark = detectWatermark(rawPages);
    const headings = detectHeadings(rawPages, watermark);
    logLine(log, `  watermark tokens:  ${watermark.length ? watermark.join(", ") : "(none)"}`);
    logLine(log, `  running headings:  ${headings.length}`);
    for (const h of headings.slice(0, 8)) logLine(log, `      - ${JSON.stringify(h)}`);

    const modalImages = (() => {
      const counts = [...imagesPerPage.values()].sort((a, b) => a - b);
      return counts.length ? counts[Math.floor(counts.length / 2)] : 0;
    })();

    const dir = join(OUT_ROOT, deck.slug);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const manifestSlides = [];
    const agg = { watermarkLines: 0, footerDropped: 0, markersDropped: 0, dupesCollapsed: 0, headingsSplit: 0 };
    const unavailable = [];

    for (let n = 1; n <= total; n++) {
      const { lines, stats } = cleanSlide(rawPages[n - 1] || "", watermark, headings);
      for (const k of Object.keys(agg)) agg[k] += stats[k];
      const body = lines.join("\n");
      const bodyChars = body.replace(/\s/g, "").length;
      const imgCount = imagesPerPage.get(n) || 0;
      const extraGraphics = modalImages > 0 && imgCount > modalImages;
      const lowText = bodyChars < 40;
      if (lowText) unavailable.push(n);

      const header = [
        `<!-- slide ${n} of ${total} · extracted via MCP ${MCP_NAME} ·`,
        `     watermark=${watermark.join(",") || "none"} ·`,
        `     chars=${bodyChars} · images=${imgCount}${extraGraphics ? " (extra embedded graphics)" : ""} -->`,
      ].join("\n");
      writeFileSync(join(dir, `slide-${String(n).padStart(2, "0")}.md`), `${header}\n\n${body}\n`, "utf8");

      manifestSlides.push({
        slide: n,
        chars: bodyChars,
        lines: lines.length,
        images: imgCount,
        extraGraphics,
        lowText,
      });
    }

    const manifest = {
      deck: deck.slug,
      sourceFile: `input/${basename(deck.file)}`,
      extractedVia: `mcp:${MCP_NAME}`,
      mcpPackage: MCP_PACKAGE,
      mcpVersion: init.serverInfo.version,
      totalSlides: total,
      processedSlides: manifestSlides.filter((s) => !s.lowText).length,
      unavailableSlides: unavailable,
      watermark,
      runningHeadings: headings,
      cleaning: agg,
      slides: manifestSlides,
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    logLine(log, `  watermark fragments:${agg.watermarkLines} lines removed`);
    logLine(log, `  footers dropped:    ${agg.footerDropped}`);
    logLine(log, `  dupes collapsed:    ${agg.dupesCollapsed}`);
    logLine(log, `  headings split:     ${agg.headingsSplit}`);
    logLine(log, `  low-text slides:    ${unavailable.length ? unavailable.join(",") : "(none)"}`);
    logLine(log, `  wrote:              extracted/${deck.slug}/ (${total} files + manifest.json)`);

    process.stdout.write(
      `  cleaned: ${agg.watermarkLines} watermark lines, ${agg.footerDropped} footers, ` +
      `${agg.dupesCollapsed} dupes, ${agg.headingsSplit} headings split\n` +
      `  low-text slides: ${unavailable.length ? unavailable.join(",") : "none"}\n`
    );

    results.push({ slug: deck.slug, ok: true, total, unavailable: unavailable.length });
  }

  client.close();
  writeFileSync(join(EVIDENCE, "extract-pdf.log"), log.join("\n") + "\n", "utf8");

  console.log(`\nextraction complete: ${results.filter((r) => r.ok).length}/${decks.length} decks`);
  console.log(`log: evidence/logs/extract-pdf.log`);
}

run().catch((e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
