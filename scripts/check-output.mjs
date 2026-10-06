#!/usr/bin/env node
// Verifies the generator's output files exist and are internally consistent.
// Dependency-free: Node built-ins only.
//
//   npm run check
//
// This checks structure and traceability. It cannot prove absence of invention - that is
// what the Course Recap Reviewer sub-agent is for.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const problems = [];
const notes = [];
const ok = (m) => notes.push(`  ok   ${m}`);
const bad = (m) => problems.push(m);

const REQUIRED_FILES = [
  "output/course_recap.md",
  "output/course_recap.json",
  "output/course_concept_diagram.mmd",
];

console.log("course-recap-generator :: output check\n");

// ---- 1. files exist
for (const rel of REQUIRED_FILES) {
  const p = join(ROOT, rel);
  if (existsSync(p) && readFileSync(p, "utf8").trim()) ok(rel);
  else bad(`missing or empty: ${rel}`);
}

// ---- 2. manifests give us the ground-truth slide counts
const extDir = join(ROOT, "extracted");
if (!existsSync(extDir)) {
  bad("no extracted/ directory - run `npm run extract` first");
  const manifests = new Map();
} else {
  var manifests = new Map();
  for (const d of readdirSync(extDir).sort()) {
    const m = join(extDir, d, "manifest.json");
    if (!existsSync(m)) continue;
    try {
      const j = JSON.parse(readFileSync(m, "utf8"));
      manifests.set(j.deck || d, j);
    } catch (e) {
      bad(`unreadable manifest for ${d}: ${e.message}`);
    }
  }
  ok(`${manifests.size} deck manifest(s) loaded`);
}

// ---- 3. concepts files
const conceptsDir = join(ROOT, "output", "concepts");
const concepts = [];
if (existsSync(conceptsDir)) {
  for (const f of readdirSync(conceptsDir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      const j = JSON.parse(readFileSync(join(conceptsDir, f), "utf8"));
      concepts.push({ file: f, doc: j, ids: new Set((j.topics || []).map((c) => c.key_concept)) });
    } catch (e) {
      bad(`unreadable concepts file ${f}: ${e.message}`);
    }
  }
}
if (!concepts.length) bad("no concept files in output/concepts/ - run the extract-course-concepts skill");
else ok(`${concepts.length} concept file(s), ${concepts.reduce((n, c) => n + (c.doc.topics || []).length, 0)} concepts`);

// ---- 4. recap markdown carries every required section
const REQUIRED_SECTIONS = [
  "course overview",
  "deck overview",
  "topics covered",
  "key concepts",
  "important technical points",
  "examples",
  "revision points",
  "source reference",
];
const mdPath = join(ROOT, "output", "course_recap.md");
let md = "";
if (existsSync(mdPath)) {
  md = readFileSync(mdPath, "utf8");
  const lower = md.toLowerCase();
  for (const s of REQUIRED_SECTIONS) {
    if (lower.includes(s)) ok(`section present: ${s}`);
    else bad(`recap markdown missing a "${s}" section`);
  }
}

// ---- 5. every "slide N" reference in the recap must be in range for some deck
if (md && manifests.size) {
  const maxSlides = Math.max(...[...manifests.values()].map((m) => m.totalSlides || 0));
  const refs = [...md.matchAll(/\bslide\s+(\d+)\b/gi)].map((m) => parseInt(m[1], 10));
  const outOfRange = [...new Set(refs.filter((n) => n < 1 || n > maxSlides))];
  if (outOfRange.length) bad(`recap cites slide(s) outside 1..${maxSlides}: ${outOfRange.join(", ")}`);
  else if (refs.length) ok(`${refs.length} slide reference(s), all within 1..${maxSlides}`);
  else bad("recap contains no slide references at all");
}

// ---- 6. image-only / low-text slides must be disclosed, not filled
if (md && manifests.size) {
  const gaps = [];
  for (const [deck, m] of manifests) {
    for (const n of m.unavailableSlides || []) gaps.push({ deck, n });
    const extra = (m.slides || []).filter((s) => s.extraGraphics).map((s) => s.slide);
    for (const n of extra) gaps.push({ deck, n, kind: "extra-graphics" });
  }
  if (gaps.length) {
    const declared = /\b(unavailable|not extracted|image[- ]only|could not be extracted|low[- ]text|no text layer|not recovered)\b/i.test(md);
    if (declared) ok(`extraction limitations disclosed in recap (${gaps.length} gap slide(s) known)`);
    else bad(`${gaps.length} gap slide(s) known but the recap does not disclose any limitation`);
  } else {
    ok("no gap slides recorded");
  }
}

// ---- 7. diagram labels must come from the concepts files
// Ground truth = every topic, subtopic and key_concept across the concept files. Topic
// labels are the source's own part headings, so they are legitimately grounded.
// Comparison normalises punctuation, because the source uses U+2019 curly apostrophes
// while a hand-written diagram may use ASCII ones for the same word.
const norm = (s) =>
  String(s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const mmdPath = join(ROOT, "output", "course_concept_diagram.mmd");
if (existsSync(mmdPath)) {
  const mmd = readFileSync(mmdPath, "utf8");
  if (/^\s*(graph|flowchart)\s|sequenceDiagram|mindmap|classDiagram/m.test(mmd)) ok("diagram declares a Mermaid diagram type");
  else bad("diagram has no recognisable Mermaid header");

  const terms = new Set();
  for (const c of concepts) {
    for (const t of c.doc.topics || []) {
      if (t.topic) terms.add(norm(t.topic));
      if (t.subtopic) terms.add(norm(t.subtopic));
      if (t.key_concept) terms.add(norm(t.key_concept));
    }
  }

  // Node labels: `ID["label"]`, `ID(label)`, `ID{"label"}` and bare `ID["a"]["b"]` forms.
  const nodes = [...mmd.matchAll(/^\s*([A-Za-z0-9_]+)\s*(?:\[\[?|\(\(|\{|\()\s*"?([^"\]\)\}\n]+)"?\s*(?:\]\[?|\)\)|\})/gm)]
    .map((m) => (m[2] || "").trim())
    .filter(Boolean);

  const ungrounded = [...new Set(nodes.filter((n) => !terms.has(norm(n))))];
  if (!nodes.length) bad("diagram has no node labels to check");
  else if (ungrounded.length) bad(`diagram has ${ungrounded.length} label(s) not found in any concepts file: ${ungrounded.slice(0, 8).map((s) => JSON.stringify(s)).join(", ")}`);
  else ok(`all ${nodes.length} diagram label(s) traced to extracted concepts (topics, subtopics and key_concepts)`);
} else {
  bad("missing output/course_concept_diagram.mmd");
}

// ---- 8. recap JSON shape
const jsonPath = join(ROOT, "output", "course_recap.json");
if (existsSync(jsonPath)) {
  try {
    const j = JSON.parse(readFileSync(jsonPath, "utf8"));
    const need = ["course_overview", "decks", "topics", "key_concepts", "important_technical_points", "examples", "revision_points", "extraction_limitations"];
    const missing = need.filter((k) => !(k in j));
    if (missing.length) bad(`course_recap.json missing key(s): ${missing.join(", ")}`);
    else ok(`course_recap.json has all ${need.length} required keys`);
    if (Array.isArray(j.decks) && manifests.size) {
      if (j.decks.length !== manifests.size) bad(`course_recap.json lists ${j.decks.length} decks but ${manifests.size} were extracted`);
      else ok(`course_recap.json covers all ${j.decks.length} decks`);
    }
  } catch (e) {
    bad(`course_recap.json is not valid JSON: ${e.message}`);
  }
}

// ---- 9. reviewer verdict recorded
const revPath = join(ROOT, "output", "course_recap_review.json");
if (existsSync(revPath)) {
  try {
    const r = JSON.parse(readFileSync(revPath, "utf8"));
    if (r.overall_status) ok(`reviewer verdict: ${r.overall_status}`);
    else bad("review file has no overall_status");
  } catch (e) {
    bad(`course_recap_review.json invalid: ${e.message}`);
  }
} else {
  bad("missing output/course_recap_review.json - the reviewer stage did not run");
}

console.log(notes.join("\n"));
console.log("");
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s):`);
  problems.forEach((p) => console.log("  x    " + p));
  process.exit(1);
}
console.log("PASSED — all structural and traceability checks clean.");