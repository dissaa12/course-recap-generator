#!/usr/bin/env node
// Validator for extract-course-concepts output (schema_version "1").
// Dependency-free: Node built-ins only.
//
//   node validate-concepts.mjs <output.json> [--source <source-file-or-dir>] [--strict]
//
// Without --source it checks structure only. With --source it also verifies that every
// source_reference.quote appears verbatim in the source text, which is the strongest
// mechanical guard against invented or hallucinated quotes.
//
// Exit 0 = no errors. Exit 1 = errors found. Warnings do not fail the run.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = [
  "topic", "subtopic", "key_concept", "explanation",
  "examples", "important_terms", "revision_points", "source_reference",
];
const SUPPORTING = ["availability", "confidence"];
const AVAILABLE = ["available", "partial", "unavailable"];
const CONFIDENCE = ["high", "medium", "low"];
const GAP_KINDS = [
  "image_only_table", "image_only_diagram", "image_only_figure",
  "no_text_layer", "empty_slide", "truncated_text",
];
const REF_FIELDS = ["lecture", "slide", "page", "section", "quote"];

const errors = [];
const warnings = [];
const err = (i, m) => errors.push(`[${i}] ${m}`);
const warn = (i, m) => warnings.push(`[${i}] ${m}`);

// --- noise handling (SKILL.md §7) -------------------------------------------
// A watermark is NOT recognised by a hardcoded word list. Per §7 it is detected
// heuristically: a short token that (a) repeats several times WITHIN a single line
// and (b) recurs across a large fraction of lines. The intra-line threshold is 3 so
// that ordinary repeated furniture (a heading printed twice => token appears 2x) is
// not mistaken for noise. Explicit overrides may be added with --noise <pattern>.

const argv0 = process.argv.slice(2);
const explicitNoise = [];
for (let i = 0; i < argv0.length; i++) {
  if (argv0[i] === "--noise" && argv0[i + 1]) explicitNoise.push(argv0[i + 1]);
}

function detectWatermarks(text) {
  const lines = text.split(/\r?\n/);
  const lineHits = new Map();
  let eligible = 0;
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) continue;
    eligible++;
    const inLine = new Map();
    for (const t of tokens) inLine.set(t, (inLine.get(t) || 0) + 1);
    for (const [t, n] of inLine) {
      if (n >= 3 && t.length <= 32) lineHits.set(t, (lineHits.get(t) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(eligible * 0.3));
  const found = [];
  for (const [t, hits] of lineHits) {
    if (hits >= threshold) found.push(t);
  }
  return found.sort((a, b) => b.length - a.length);
}

const squash = (s) => String(s).replace(/\s+/g, " ").trim();

function loadSource(target) {
  const files = [];
  if (!existsSync(target)) return null;
  if (statSync(target).isDirectory()) {
    for (const f of readdirSync(target).sort()) files.push(join(target, f));
  } else {
    files.push(target);
  }
  return files
    .filter((f) => statSync(f).isFile())
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

const argv = argv0;
const file = argv.find((a) => !a.startsWith("--") && !explicitNoise.includes(a));
const sourceArg = argv.includes("--source") ? argv[argv.indexOf("--source") + 1] : null;
const strict = argv.includes("--strict");

if (!file || !existsSync(file)) {
  console.error(
    "usage: node validate-concepts.mjs <output.json> [--source <path>] [--noise <pattern>]... [--strict]"
  );
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`FATAL: not valid JSON — ${e.message}`);
  process.exit(1);
}

if (doc.schema_version !== "1") err("root", `schema_version must be "1", got ${JSON.stringify(doc.schema_version)}`);
for (const k of ["source", "noise_handling", "topics", "unavailable_content", "extraction_notes"]) {
  if (!(k in doc)) err("root", `missing top-level key "${k}"`);
}

const src = doc.source || {};
if (src.total_slides !== undefined && !Number.isInteger(src.total_slides)) err("source", "total_slides must be an integer");
for (const k of ["processed_slides", "total_slides"]) {
  if (src[k] === undefined) warn("source", `${k} not set; reconciliation check skipped`);
}
if (src.processed_slides !== undefined && src.total_slides !== undefined) {
  const accounted = src.processed_slides + (src.unavailable_slides || []).length;
  if (accounted > src.total_slides) {
    err("source", `processed_slides (${src.processed_slides}) + unavailable_slides (${(src.unavailable_slides || []).length}) exceeds total_slides (${src.total_slides})`);
  }
}

const nh = doc.noise_handling || {};
if (!Array.isArray(nh.ignored_patterns)) warn("noise_handling", "ignored_patterns missing or not an array");

const topics = doc.topics || [];
if (!Array.isArray(topics)) err("topics", "topics must be an array");

const rawSource = sourceArg ? loadSource(sourceArg) : null;
const detectedNoise = rawSource ? detectWatermarks(rawSource) : [];
const noiseSet = [...new Set([...detectedNoise, ...explicitNoise])]
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);

const sourceRaw = rawSource === null ? null : squash(rawSource);
const sourceStripped =
  rawSource === null
    ? null
    : squash(noiseSet.reduce((acc, n) => acc.split(n).join(" "), rawSource));

if (sourceArg && rawSource === null) err("root", `--source path not found: ${sourceArg}`);

// Rule 10: ordering + contiguity
let lastGroup = null;
const seenGroups = new Set();
topics.forEach((c, i) => {
  const id = `concept ${i + 1}`;
  const group = `${c.topic}||${c.subtopic}`;

  if (lastGroup !== null && group !== lastGroup) {
    if (seenGroups.has(group)) {
      err(id, `group "${group}" is non-contiguous; concepts of the same topic/subtopic must be adjacent`);
    }
    seenGroups.add(lastGroup);
  }
  lastGroup = group;

  for (const f of REQUIRED) {
    if (!(f in c)) { err(id, `missing required field "${f}"`); continue; }
    const v = c[f];
    if (f === "source_reference") continue;
    if (typeof v === "string" && v.trim() === "") err(id, `"${f}" is empty`);
  }
  for (const f of ["examples", "important_terms", "revision_points"]) {
    if (f in c && !Array.isArray(c[f])) err(id, `"${f}" must be an array (use [] when empty, never omit)`);
    if (Array.isArray(c[f]) && c[f].some((x) => typeof x !== "string" || !x.trim())) {
      err(id, `"${f}" must contain non-empty strings`);
    }
  }
  if ("availability" in c && !AVAILABLE.includes(c.availability)) err(id, `availability must be one of ${AVAILABLE}`);
  if ("confidence" in c && !CONFIDENCE.includes(c.confidence)) err(id, `confidence must be one of ${CONFIDENCE}`);
  for (const f of SUPPORTING) {
    if (!(f in c)) warn(id, `supporting field "${f}" absent`);
  }

  const ref = c.source_reference;
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    err(id, "source_reference must be an object");
  } else {
    const present = Object.keys(ref);
    for (const f of present) {
      if (!REF_FIELDS.includes(f)) err(id, `source_reference has unknown key "${f}"`);
      if (ref[f] === null && f !== "quote") warn(id, `source_reference.${f} is null; prefer omitting the key`);
    }
    if (ref.slide !== undefined && !Number.isInteger(ref.slide)) err(id, "source_reference.slide must be an integer");
    if (ref.page !== undefined && !Number.isInteger(ref.page)) err(id, "source_reference.page must be an integer");
    if (present.length === 0) err(id, "source_reference is empty; keep the pointer");

    // Rules 1/2/4: a quote that is not in the source is an invention.
    if (ref.quote) {
      const q = squash(ref.quote);
      if (sourceRaw === null) {
        warn(id, "quote present but no --source given; verbatim check skipped");
      } else {
        const inRaw = sourceRaw.includes(q);
        const inStripped = sourceStripped.includes(q);
        if (!inRaw && !inStripped) {
          err(id, `source_reference.quote NOT FOUND verbatim in source: ${JSON.stringify(ref.quote)}`);
        } else if (!inRaw) {
          warn(id, "quote matched only after watermark stripping - it appears to contain watermark/noise text");
        }
        for (const n of noiseSet) {
          if (q.toLowerCase().includes(n.toLowerCase())) {
            warn(id, `quote contains detected watermark token ${JSON.stringify(n)}; strip it from the quote`);
          }
        }
      }
      // Unmapped glyphs: private-use codepoints mean the font could not encode the
      // character. Flag rather than let them pass as clean text.
      const pua = [...ref.quote].filter((ch) => {
        const cp = ch.codePointAt(0);
        return (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd);
      });
      if (pua.length) {
        const codes = pua.map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase());
        warn(id, `quote contains ${pua.length} private-use codepoint(s) [${codes.join(", ")}] - unmapped glyph; ensure this is recorded in extraction_notes and confidence is not "high"`);
        if (c.confidence === "high") {
          err(id, `quote has unmapped glyphs but confidence is "high"; use "medium" and record the defect in extraction_notes`);
        }
      }
    }
  }
});

// Rule 6: gaps must be declared, not silently filled.
for (const [i, u] of (doc.unavailable_content || []).entries()) {
  const id = `unavailable_content ${i + 1}`;
  for (const f of ["location", "kind", "note", "adjacent_text_used"]) {
    if (!(f in u)) err(id, `missing field "${f}"`);
  }
  if (u.kind && !GAP_KINDS.includes(u.kind)) err(id, `kind must be one of ${GAP_KINDS}`);
  if (topics.some((c) => c.availability === "unavailable")) {
    err(id, "unavailable_content declared while a concept is marked availability=unavailable; gaps belong here, not in topics");
  }
}
if (sourceRaw !== null && topics.some((c) => (c.source_reference || {}).quote)) {
  const quoted = topics.map((c) => c.source_reference.quote).filter(Boolean);
  const dupes = quoted.filter((q, i) => quoted.indexOf(q) !== i);
  if (dupes.length) warn("root", `${dupes.length} quote(s) reused across concepts`);
}

// Rule 10: derivation fields
const counts = doc.counts;
if (counts) {
  const expected = {
    missing_concepts: 0,
    concepts: topics.length,
  };
  void expected;
  if (counts.concepts !== undefined && counts.concepts !== topics.length) {
    err("counts", `counts.concepts (${counts.concepts}) != topics.length (${topics.length})`);
  }
}

console.log(`file:      ${file}`);
console.log(`source:    ${sourceArg || "(not supplied — quote checks skipped)"}`);
console.log(`watermark: ${noiseSet.length ? noiseSet.map((n) => JSON.stringify(n)).join(", ") : "(none detected)"}`);
console.log(`concepts:  ${topics.length}`);
console.log(`gaps:      ${(doc.unavailable_content || []).length}`);
console.log(`errors:    ${errors.length}`);
console.log(`warnings:  ${warnings.length}`);
if (warnings.length) {
  console.log("\n--- warnings ---");
  warnings.forEach((w) => console.log("  " + w));
}
if (errors.length) {
  console.log("\n--- errors ---");
  errors.forEach((e) => console.log("  " + e));
  process.exit(1);
}
console.log("\nOK — no errors.");
if (strict && warnings.length) {
  console.log("strict: warnings present");
  process.exit(1);
}
process.exit(0);
