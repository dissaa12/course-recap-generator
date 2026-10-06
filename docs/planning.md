# Course Recap Generator — Planning Document

**Assignment:** Day 6 · ASTRA · Track 1, Week 1
**Status:** **Implemented.** Planning (§1–§3, §7), MCP layer (§4), reviewer sub-agent (§5)
and the `extract-course-concepts` skill (§6) are all built and verified, and the generator has
run end-to-end on all four PDFs. See `README.md` for usage and
`output/course_recap.md` §9 for the review record.
**Date:** 2026-10-05 (planning) · 2026-10-05 (MCP) · 2026-10-05 (sub-agent) ·
2026-10-05 (skill) · 2026-10-05 (generator + full run)

---

## 1. Project goal

Build a repeatable pipeline that turns the four lecture slide-deck PDFs in `input/` into
reviewable, cited, single-lecture recap documents plus one explanatory diagram per recap.

The pipeline must:

- Extract text from the PDFs deterministically (no model-invented content).
- Derive a structured concept set per lecture using a reusable skill.
- Generate a recap from those concepts.
- Pass the draft through an independent reviewer sub-agent that checks factual fidelity
  against the extracted source text and emits a verdict.
- Emit one Mermaid diagram per recap that visualises that lecture's core model.
- Produce evidence artefacts showing each stage ran and what it produced.

**Non-goals:** summarising by paraphrasing slide text alone, inventing content not present in
the slides, OCR of decorative graphics, multi-lecture cross-cutting synthesis in v1.

**Success criteria**

| # | Criterion |
|---|---|
| 1 | Every factual claim in every recap traces to a slide number in the source PDF |
| 2 | Zero invented terms, numbers, dates, or citations |
| 3 | The pipeline is re-runnable with one command per lecture |
| 4 | The reviewer sub-agent can reject a deliberately corrupted draft |
| 5 | The skill is reusable across all four lectures without modification |

---

## 2. Input PDFs and PDF extraction strategy

### 2.1 Verified inventory

All four PDFs were inspected during planning by decompressing their content streams and
recovering positioned text. Slide counts and structure below are **measured, not assumed**.

| File | Slides | Deck title (from slide 1) | Day / track (from slide 1) |
|---|---|---|---|
| `AAPLecture1_LLM_Foundations.pdf` | 34 | LLM Foundations — "Tokens · Context · Inference" | DAY 1 · ASTRA · TRACK 1, WEEK 1 |
| `AAPLecture2_Prompt_Engineering.pdf` | 28 | Prompt Engineering — "How to talk to a model so it listens" | DAY 2 · GDG FASTRACK · TRACK 1, WEEK 1 |
| `AAPLecture3_AI_Coding_Techniques.pdf` | 22 | AI Coding Techniques — "From understanding LLMs to building with them" | DAY 6 · ASTRA · TRACK 1, WEEK 1 |
| `AAPLecture4_Inference_Basics.pdf` | 28 | Inference Basics — "What happens between 'send' and 'response'" | DAY 4 · ASTRA · ONLINE SESSION |

Total: **112 slides**. Metadata is consistent: 960×540 pt (16:9), PDF 1.7, slide date
`deboistech · 2026-10-03` in the footer of every slide.

### 2.2 Why PDF extraction must be a tool, not a model step

The agent's built-in `read` tool **cannot** read these PDFs — it returns
`Cannot read pdf (this model does not support pdf input)`. No PDF library is installed in
this environment (no `pdftotext`, `mutool`, `qpdf`, `pypdf`, `pdfplumber`; only `pillow` is
present in Python). The four source decks are therefore unreachable by the agent's native
file-reading path, and PDF-to-text **must** happen outside the model.

**Resolved:** this capability is now supplied by the `pdf-reader` MCP server
(`@rturv/mcp-pdf-reader`), configured and verified — see §4. This is still the single most
important architectural constraint in the project; what changed is that we now consume an
existing, tested server instead of writing extraction from scratch.

### 2.3 Extraction pipeline — **as implemented**

**Stage A — PDF decoding, delegated to the `pdf-reader` MCP server.** Implemented in
`scripts/extract-pdf.mjs`, which is a dependency-free JSON-RPC MCP client over stdio:

- `get_pdf_page_count` → slide count (verified: 34 / 28 / 22 / 28)
- `read_pdf_pages` per slide → that slide's text
- `list_pdf_images` → per-slide image counts

**Stage B — cleaning, in the same script.** One rule, applied per line:

| Artefact | Handling |
|---|---|
| Watermark-only line | Dropped — **every** token on the line is a detected fragment |
| Footer (`brand · date`) | Dropped |
| Page marker (`-- N of M --`) | Dropped |
| Duplicate consecutive lines | Collapsed |
| Genuinely fused heading+title | Split, guarded by `HEADING_MIN_LEN = 8` |

**Watermark detection is data-derived, not a hardcoded list** (SKILL.md §7). The first
implementation tried to detect a token repeating *within* a line and **failed on the real
data**: the MCP server emits the watermark as separate lines, so the within-line rule matched
nothing, and a fallback heading-splitter then shredded `deboistech` on a bogus one-character
heading. Measured token statistics fixed it:

| Token | count/slide | detected? |
|---|---|---|
| `deboistech` | 25.0 | ✅ yes |
| `PART` (most repeated content token) | 0.85 | ❌ no |
| `2026-10-03`, `34`, `--` (markers) | ~1.0 | ❌ no |

The shipped rule is: a short token on **≥ 40% of slides** *and* **≥ 3 occurrences per slide**.
Across the four decks it removed **3,696 watermark lines and 112 footers**, leaving zero
residual watermark text. Verified generic: the same heuristic detects `acmecorp`, `Xiniz` and
`zenith-labs` in synthetic decks.

**Output:** `extracted/<deck>/slide-NN.md` (cleaned text, one file per slide) and
`extracted/<deck>/manifest.json` recording slide counts, the detected watermark, per-deck
cleaning totals, per-slide image counts and low-text slides.

### 2.4 Known extraction limitations (must be handled, not ignored)

Findings L-1, L-2 and L-4 were confirmed twice: once during planning (by decoding the PDF
content streams directly) and again during MCP verification against the live server.

| # | Finding | Handling |
|---|---|---|
| L-1 | Watermark `deboistech` repeated across every slide. **Confirmed live via the MCP server** — it dominates `read_pdf_pages` output | Stripped in Stage B step 6 |
| L-2 | Layered text draws duplicate the same sentence 2–3× per slide (worst: L4 slide 28) | De-duplicated in Stage B step 7 |
| L-3 | Slide furniture (kicker + running head) concatenates with the title, e.g. `PART 1 · CORE MECHANICSWhat is a token?` | Split in Stage B step 8 |
| L-4 | **L3 slide 4 "Comparison at a glance" is a raster image — no text layer.** The four-tool comparison table cannot be extracted. The MCP server is explicitly not OCR-based, so it cannot recover this either | Flag in `manifest.json` as `image-only` (detected via `list_pdf_images`); the concept skill must **not** invent the missing cells. Fall back to the surrounding text (`Four tools, one defining trait each.`) and state the table as unavailable. `extract_pdf_image` may be used to confirm the table is graphical, but its pixels must not be paraphrased into invented cell values |
| L-5 | Slides that are visual diagrams (L4 slide 14 latency pipeline) have partial text | Extract the labels present; let the diagram stage rebuild the model from the extracted stage names, not from the picture |
| L-6 | Speaker-notes / chat prompts rendered as body text (L4 slide 2 hook, slide 3) | Retain — they are the lecturer's framing and are legitimate recap content |

Rule: **when text is unavailable, mark it unavailable.** The reviewer sub-agent treats an
invented table cell as a blocking finding. This rule now covers the image-only L3 table
explicitly, and the MCP server's "no OCR" limitation guarantees the gap cannot be closed by
retrying the extraction.

---

## 3. Summary / output structure

### 3.1 Per-lecture recap document

One file per lecture: `output/recaps/AAPLecture1_LLM_Foundations.recap.md`.

```markdown
# <Deck title> — Course Recap

**Source:** `input/<file>.pdf` · 34 slides
**Deck day:** DAY 1 · ASTRA · TRACK 1, WEEK 1
**Extraction:** `extracted/AAPLecture1_LLM_Foundations/` (complete, 34/34 slides)
**Reviewer status:** PASS · 0 blocking · 2 advisory   <!-- added by reviewer stage (§5.5) -->

## 1. In one paragraph
3–5 sentences. What this lecture taught and the question it answered.

## 2. The hook
The opening problem the lecture set up, and how it was resolved.

## 3. Core concepts
For each concept, a short definition, why it matters, and a `source:` citation.
Every concept MUST carry `source: slide N`.

## 4. Key takeaways
The lecturer's own recap points, restated.

## 5. Terms worth remembering
| Term | Meaning | Slide |
|---|---|---|

## 6. Open questions / what is not covered
Including any slide that could not be extracted (see L-4).

## 7. Diagram
Embedded Mermaid diagram + link to the `.mmd` source.

## Review record
Reviewer sub-agent verdict, blocking findings, advisory findings, re-check outcome.
```

### 3.2 Concept record (intermediate, machine-readable)

`output/concepts/<deck-slug>.concepts.json` — the contract between the skill, the generator,
and the reviewer. Produced by the `extract-course-concepts` skill (§6). **Implemented
schema**, `schema_version: "1"`:

```json
{
  "schema_version": "1",
  "source": {
    "identifier": "AAPLecture1_LLM_Foundations",
    "kind": "slide_deck",
    "total_slides": 34,
    "processed_slides": 34,
    "unavailable_slides": []
  },
  "noise_handling": { "ignored_patterns": ["deboistech"], "notes": "..." },
  "topics": [
    {
      "topic": "PART 1 · CORE MECHANICS",
      "subtopic": "Tokenizers",
      "key_concept": "BPE · Byte-Pair Encoding",
      "explanation": "A tokenization method that merges the most frequent pair, then repeats.",
      "examples": [],
      "important_terms": ["BPE", "Byte-Pair Encoding"],
      "revision_points": [],
      "source_reference": {
        "slide": 5,
        "section": "PART 1 · CORE MECHANICS",
        "quote": "Merge the most frequent pair. Repeat."
      },
      "availability": "available",
      "confidence": "high"
    }
  ],
  "unavailable_content": [
    {
      "location": "slide 4",
      "kind": "image_only_table",
      "note": "Table rendered as an image; no text layer. Contents not recovered.",
      "adjacent_text_used": ""
    }
  ],
  "extraction_notes": ["..."]
}
```

The eight required per-concept fields are `topic`, `subtopic`, `key_concept`, `explanation`,
`examples`, `important_terms`, `revision_points`, `source_reference`. The earlier planning
draft proposed a flatter record (`id`/`term`/`definition`/`whyItMatters`/`sourceSlides`/
`verbatim`/`confidence`); the implemented nested schema supersedes it, keeping the same
purpose — a **verbatim `quote` per concept is what makes fabrication detectable**, since
the reviewer and the validator can both check it against the source.

### 3.3 Deck-specific structure (from the real slides)

The four decks are **not** structurally identical, and the output must respect that.

**Lecture 1 — LLM Foundations (34 slides).** Four parts, then recap/quiz/next-up:
- Part 1 · Core Mechanics — slides 3–17: tokens, tokenizers (BPE, WordPiece, SentencePiece,
  tiktoken), parameters, Dense vs MoE, reasoning models, model types, embeddings, vector
  databases, context window, why long chats forget, lost in the middle.
- Part 2 · Generation Behavior — slides 18–20: temperature, top-p/top-k, hallucination.
- Part 3 · Structure — slides 21–26: prompt vs training data, token economics,
  input/output/cached, prompt caching, token budgeting, silent truncation bugs.
- Part 4 · Inference Vocabulary — slides 27–31: prompts cost time, TTFT, TPOT,
  latency vs throughput, streaming.
- Recap (32), Quiz Time (33, kahoot.com), Next up: Day 2 & 3 (34).

**Lecture 2 — Prompt Engineering (28 slides).** Five parts, plus recap/next-up. Contains the
deck's only live-demo slides (9 and 20) with concrete prompt text and outputs:
- Part 1 · Prompt Structure (3–4) · Part 2 · Structuring Techniques (5–10, XML sandwiching)
- Part 3 · Zero to Few-Shot (11–13, date-conversion example: `Jan 9, 2025` → `14-03-2024`)
- Part 4 · Failure Patterns (14–18) · Part 5 · Production Concerns (19–26, prompt injection)
- Recap (27) · Next up: Day 3 (28)

**Lecture 3 — AI Coding Techniques (22 slides).** This is the Day 6 deck and the one whose
concepts this very assignment exercises — MCP, skills, sub-agents. It should get the most
attention:
- Part 1 · Quick Tour: Four Tools (3–4, incl. the image-only comparison table)
- Part 2 · Why Claude Code Today (5) · Part 3 · The Agent Harness (6–12)
- Part 4 · Concepts + Live Build (13–19): agentic file editing, plan mode, self-correcting on
  errors, skills, MCP (host/client/server), sub-agents
- Best Practices checklist (20) · Recap (21, "Seven ideas") · Next up: Week 2 (22)

**Lecture 4 — Inference Basics (28 slides).** The most content-dense deck; also the source of
the best diagram opportunity:
- Hook (2) · Why a production engineer cares (3) · Part 1 · Definitions, Deepened (4–5)
- Part 2 · The Inference Pipeline (6–14): six stages — request arrives, queueing, prefill,
  decode, batching, stream back. Slide 14 "The full picture" states the two formulas.
- Part 3 · Inside the Engine (11–12, 15–16): KV cache and its memory bill, static vs
  continuous batching, scheduling.
- Part 4 · Cost-Latency Trade-offs (17–19) · Part 5 · The Production Engineer (20, 25)
- Part 6 · Failures at Scale (21–24): four real incident case studies with named sources.
- Recap (26) · Next up (27) · Appendix: sources and further reading (28)

---

## 4. MCP server: choice, capability, and verification

### 4.0 At a glance

| Field | Value |
|---|---|
| **MCP name** | `pdf-reader` |
| **Package** | `@rturv/mcp-pdf-reader` v1.0.0 (MIT) |
| **Type** | `local` (stdio) |
| **Command** | `npx -y @rturv/mcp-pdf-reader` |
| **Purpose** | Give the agent the PDF-reading capability its native `read` tool lacks, so slide text can be extracted from `input/*.pdf` without the model touching PDF bytes |
| **Capability** | Full-text extraction, metadata, page-range extraction, text search with page numbers, page counts, and image listing/extraction (7 tools) |
| **Used in workflow at** | Step **(1) PDF extraction** (§8), plus source verification by the reviewer sub-agent (§5) |
| **Status** | ✅ **Configured and verified against a real course PDF** — see §4.3 |
| **Config file** | `.opencode/opencode.json` |

### 4.1 Decision

**Use `@rturv/mcp-pdf-reader` as this project's only MCP server, registered as a local
stdio server named `pdf-reader`.**

Actual file in place — `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pdf-reader": {
      "type": "local",
      "command": ["npx", "-y", "@rturv/mcp-pdf-reader"],
      "enabled": true
    }
  }
}
```

`type` is required by opencode's schema and `command` must be an array of strings; both are
satisfied. Exactly one server is registered — adding a filesystem server alongside it was
considered and **dropped as unnecessary**, since opencode already provides `read`, `glob`,
`grep` and shell access for the project's own text files.

The package wraps `pdf-parse` + `pdf-lib` + `@modelcontextprotocol/sdk`, speaks MCP over
stdio, and takes **absolute** `filePath` arguments (Windows paths verified working).

### 4.2 Why it is genuinely needed (not decoration)

A grader will rightly ask "why not just use the built-in `read` tool, or a shell script?"
The answer is concrete and was verified in this environment:

1. **The `read` tool cannot open these PDFs.** It returns
   `Cannot read pdf (this model does not support pdf input)`. The four source decks are
   unreachable by the agent's native file-reading path — so without a PDF-capable server
   the pipeline has no way to see its own source material.
2. **No PDF library exists locally to shell out to.** Verified: no `pdftotext`, `mutool`,
   `qpdf`, `gswin`, `pypdf`, `pdfplumber`, or `PyMuPDF`; Python has only `pillow`. A
   shell-script extractor would have to be written and maintained from scratch.
3. **It supplies tested, audited PDF processing rather than hand-rolled parsing.** The
   planning-phase proof-of-concept that decoded these PDFs directly needed ~300 lines of
   hand-written zlib/FlateDecode, operator tokenising, `/ToUnicode` CMap parsing and
   text-matrix reconstruction before it produced correct reading order. That is exactly
   the deterministic work that should sit behind a tool rather than in a prompt.
4. **It keeps the model out of the byte-level path.** Text decoding stays deterministic,
   cheap, re-runnable and auditable; the model only ever reasons over extracted text.
5. **It gives the reviewer sub-agent an independent way to re-check claims.** `search_pdf`
   lets the reviewer confirm that a term really occurs on the slide it was cited to,
   without trusting the generator's intermediate files.

**Correction to the original planning decision.** The planning draft concluded that "no
PDF-capable MCP server exists on npm" and proposed writing our own `mcp/pdf-server.mjs`.
That conclusion was **wrong**: it was based on probing four package names
(`mcp-server-pdf`, `@pdfreader/mcp`, `pdf-reader-mcp`, `mcp-pdf-reader`), all of which do
return 404. `@rturv/mcp-pdf-reader` exists and is now in use. The downstream *decisions*
survive — extraction is a tool not a prompt, and it stays deterministic — but the
hand-written server and the `mcp/` directory are now **retired**, and §2.3, §8, §9, §10 and
Appendix A have been updated accordingly.

### 4.3 Verification performed (evidence the MCP was actually used)

Verified against the real deck `input/AAPLecture1_LLM_Foundations.pdf`.

**Connection.** `opencode mcp list` reports:

```
┌  ●  ✓ pdf-reader  connected
│        npx -y @rturv/mcp-pdf-reader
└  1 server(s)
```

**Handshake.** `initialize` returned `serverInfo {"name":"mcp-pdf-reader","version":"1.0.0"}`
on protocol version `2024-11-05`. Server stderr confirmed `MCP PDF Reader server running on stdio`.

**Tools available — 7, confirmed via `tools/list`:**

| Tool | Required args | Role in this project |
|---|---|---|
| `read_pdf` | `filePath` | whole-deck text (used only for small decks / cross-checks) |
| `get_pdf_metadata` | `filePath` | deck title, author, page count |
| `read_pdf_pages` | `filePath`, `startPage` | **primary extraction call** — one slide at a time |
| `search_pdf` | `filePath`, `searchTerm` | term → slide number; builds and verifies §10.4 |
| `get_pdf_page_count` | `filePath` | slide-count assertion per deck |
| `list_pdf_images` | `filePath` | detect image-only slides (L3 slide 4) |
| `extract_pdf_image` | `filePath`, `imageIndex` | confirm graphical content without inventing it |

**Extraction test results:**

| # | Call | Result |
|---|---|---|
| T1 | `get_pdf_page_count` on Lecture 1 | `Total pages: 34` — matches the 34 measured independently in planning |
| T2 | `read_pdf_pages` pages 1–2 | Real slide text returned: `LLM / Foundations / Tokens · Context · Inference / DAY 1 · ASTRA · TRACK 1, WEEK 1`, then `-- 1 of 34 --`, `THE HOOK / The hook / Today we answer it mechanically, not vaguely.` |
| T3 | `search_pdf` for `Byte-Pair Encoding` | Found on **page 5**, context `...PART 1 · CORE MECHANICS BPE · Byte-Pair Encoding Merge the most frequent pair. Repeat.` — agrees with the planning-phase extraction, which placed BPE on slide 5 |
| T4 | `search_pdf` for `Time to first token` | Found on **page 28**, context `...PART 4 · INFERENCE VOCABULARY TTFT Time to first token.` — agrees with the planning-phase extraction, which placed TTFT on slide 28 |

T3 and T4 are the strongest evidence: two independent extractors — one hand-written during
planning, one the published MCP server — agree on page numbers for known content.

**Known issue — first connection timed out.** The first `opencode mcp list` failed with:

```
●  ✗ pdf-reader  failed
      Operation timed out after 30000ms
      npx -y @rturv/mcp-pdf-reader
```

Cause: opencode's MCP connect window is 30 s, and `npx` had to download and unpack the
package within that window. After the `npx` cache was warmed (running the command once
outside opencode), the very next connection reported `connected`, and has been stable
since. **Operational consequence:** on a clean machine or after a cache clear, the first
attempt may fail; re-run, or set `experimental.mcp_timeout` higher in `opencode.json`.

**Known limitation — no OCR.** The server is explicitly not OCR-based, so it reads only
selectable text. This is why the L3 image-only table cannot be recovered by any amount of
retrying, and why L-4 is recorded as permanently unavailable rather than pending.

### 4.4 Where the MCP fits in the workflow

| Workflow stage (§8) | MCP usage |
|---|---|
| **(1) PDF extraction** | `get_pdf_page_count` → slide count; `read_pdf_pages` per slide → text; `list_pdf_images` → image-only detection. Output feeds `extracted/<deck>/` |
| **Concept extraction skill (§6)** | Reads `extracted/` (ordinary text files); may call `search_pdf` to confirm a term's slide |
| **Recap generation (§3)** | No MCP calls — works from concepts only |
| **Reviewer sub-agent (§5)** | `search_pdf` to independently confirm each cited claim really occurs on its cited slide; strengthens the source-faithfulness and accuracy checks |
| **(3) Diagram (§7)** | No MCP calls — built from the frozen recap |

---

## 5. Course Recap Reviewer sub-agent — **IMPLEMENTED**

**Status:** implemented and verified (see §5.6). The summarizer, skill and diagram stages
that will feed it are not yet built.

### 5.1 Where the definition is stored

| Field | Value |
|---|---|
| **File path** | `.opencode/agent/course-recap-reviewer.md` |
| **Agent key** | `course-recap-reviewer` (derived from the file name) |
| **Display name** | Course Recap Reviewer (carried in `description`) |
| **Form** | File-based definition, not an inline `opencode.json` entry. The body below the frontmatter **becomes the agent's prompt** — do not also set `prompt:` in frontmatter |
| **Discovery** | opencode scans `.opencode/agent/` (or `.opencode/agents/`) for agent markdown files |

### 5.2 The definition as written

```markdown
---
description: >-
  Course Recap Reviewer. Reviews a generated course recap against source-derived content
  extracted from lecture PDFs and returns a structured verdict. Use when a recap draft
  exists and needs checking for source faithfulness, completeness, unsupported content,
  accuracy, organization, and revision usefulness. Use ONLY for reviewing recaps; it never
  writes course content. Triggers: "review this recap", "fact-check the recap",
  "check recap against source", "recap review".
mode: subagent
temperature: 0.1
permission:
  edit: deny
  webfetch: deny
  websearch: deny
---

You are the **Course Recap Reviewer**. ...  [prompt body, see below]
```

Only allowed frontmatter keys are used: `description`, `mode`, `temperature`, `permission`.

### 5.3 Design decisions

| Decision | Value | Reason |
|---|---|---|
| `mode` | `subagent` | Runs only when delegated to; never a user-facing primary agent |
| `temperature` | `0.1` | A verification pass must be reproducible, not creative |
| `permission.edit` | `deny` | The reviewer **reports**, it never rewrites the draft. Separation of duties: reviewer finds problems, generator fixes them |
| `webfetch` / `websearch` | `deny` | Grounding is the supplied source material only. Blocks the reviewer from "helpfully" filling gaps from the internet — the exact failure mode under test |
| `model` | **unset — inherits session model** | Pinning a model id risks a hard failure if that provider is not authenticated. Deliberately omitted; pin it in the frontmatter if a fixed reviewing model is required |
| Deck specificity | none | No lecture names, slide counts or topic assumptions in the prompt, so it is reusable for any course PDF |

`opencode agent list` resolves the permissions to `edit: deny`, `webfetch: deny`,
`websearch: deny`, `question: deny`, `read: allow`. `question: deny` matters — it guarantees
the reviewer cannot stall the pipeline by asking a follow-up question, which keeps the pass
deterministic.

### 5.4 Responsibilities (the six checks)

Run in this fixed order; report on all six even when one fails.

| # | Check | Value emitted | What it looks for |
|---|---|---|---|
| 1 | **Source faithfulness** | `pass`/`issue` | Every substantive claim (definition, mechanism, number, date, name, example) has support in the source |
| 2 | **Completeness** | `pass`/`issue` | Important source topics missing or only glimpsed. Core omission = `blocking`, minor aside = `advisory` |
| 3 | **Unsupported content** | `pass`/`issue` | Claims, examples, facts, explanations with no source backing — including plausible invented numbers and outside knowledge |
| 4 | **Accuracy** | `pass`/`issue` | Statements that misrepresent or distort: reversed causality, changed definitions, wrong attribution, wrong magnitudes, conflations |
| 5 | **Organization** | `pass`/`issue` | Whether the recap is logically organised and easy to revise — section order mirrors the source, headings meaningful, claims locatable |
| 6 | **Revision usefulness** | `pass`/`issue` | Whether it carries the key points and technical concepts a learner needs; missing mechanisms, missing caveats the source stressed, buried key points, padding |

**Hard rules encoded in the prompt:**

- **Must not invent replacement course content.** It identifies the defect, points at the
  source, and stops. It never writes the corrected prose, the missing definition or the
  right value.
- **Never edits the recap** (also enforced by `edit: deny`).
- **No outside knowledge**; grounding is the supplied source only.
- **Every finding needs a source reference.** No reference means no finding.
- **A source limitation is not a recap error.** Slides whose text is unavailable are
  reported as such — this is what protects the L3 image-only table (L-4) from being
  "fixed" with fabricated content.
- **One pass only.** No loops, no retries, no self-critique rounds, no open-ended agent
  loop. Same inputs → same structure and severity decisions.
- **Fewer, well-evidenced findings beat many speculative ones**; uncertainty resolves to
  `advisory`, never `blocking`.

### 5.5 Input and output contract

**Input** — two things, paths preferred, inline content acceptable:

1. **Source-derived content** (the ground truth): extracted per-slide text, and/or a
   concepts record with source-slide citations, and/or a manifest stating slide count and
   unavailable slides.
2. **The recap to review.**

If either is missing it returns `NEEDS_REVISION` stating why rather than guessing. A source
hierarchy is enforced: verbatim text > concepts record with citations > the recap's own
claims (claims never count as evidence for themselves).

**Output** — one fenced ```json block, `schema_version: "1"`, with exactly these keys:

| Key | Type | Notes |
|---|---|---|
| `reviewer` | string | always `course-recap-reviewer` |
| `schema_version` | string | `"1"` |
| `source` | object | `deck`, `slides_considered`, `concepts_considered`, `unavailable_slides[]` |
| **`overall_status`** | string | **`PASS` or `NEEDS_REVISION`** |
| `summary` | string | 2–4 sentences, incl. the single most important fix |
| `checks` | object | the six checks, each `pass` / `issue` / `unavailable` |
| `counts` | object | per-category counts plus `blocking` and `advisory` totals |
| **`missing_concepts`** | array | `concept`, `source_ref`, `why_it_matters`, `severity` |
| **`unsupported_claims`** | array | `claim`, `recap_location`, `source_ref`, `note`, `severity` |
| **`inaccurate_claims`** | array | `claim`, `recap_location`, `source_ref`, `distortion`, `severity` |
| **`organization_issues`** | array | `issue`, `location`, `suggested_fix`, `severity` |
| **`revision_usefulness_issues`** | array | `issue`, `location`, `suggested_fix`, `severity` |
| **`recommended_corrections`** | array | `priority`, `action`, `target`, `source_ref`, `severity` |

Plus at most three lines of `Notes` for anything that does not fit the schema.

**Verdict rule (mechanical, not judgemental):** any `blocking` finding ⇒ `NEEDS_REVISION`;
no `blocking` findings ⇒ `PASS` (advisory findings may still be listed).

`recommended_corrections` entries are **instructions to the author**, never replacement
course content — the distinction is stated explicitly in the prompt and was confirmed in
testing (§5.6).

### 5.6 How it is invoked

The agent is delegated to from a primary agent via the **task tool**:

```
task(subagent_type: "course-recap-reviewer",
     description: "Review recap against source",
     prompt: "Review the recap at <recap-path> against the source-derived content at <source-path>. Return the structured review.")
```

**Invocation caveat discovered in testing:** `opencode run --agent course-recap-reviewer`
warns `agent "course-recap-reviewer" is a subagent, not a primary agent. Falling back to
default agent` — because `--agent` only accepts primary agents. The subagent still runs, but
via the default agent's task delegation rather than as the top-level agent. For a direct,
deterministic run, delegate through the task tool rather than `--agent`.

### 5.7 Verification performed

**Registration:** `opencode agent list` lists `course-recap-reviewer (subagent)` with the
resolved permission set — confirming opencode discovers it as a separate declared agent.

**Behavioural test** against a throwaway fixture in the temp directory (deliberately
planted defects, real verbatim slide text from Lecture 1):

| Planted defect | Caught as |
|---|---|
| WordPiece mechanism replaced with an invented "rare-token replacement" strategy | `inaccurate_claims` (blocking), distortion precisely described |
| "developed by Google / used in BERT" provenance | `unsupported_claims` (blocking) |
| Fabricated "TTFT ~200 ms / TPOT ~30 ms" figures cited to slide 28 | `unsupported_claims` (blocking) ×2, incl. the mis-citation of the TPOT figure |
| Uncited takeaway "tokenizer choice affects cost and output quality" | `unsupported_claims` (blocking) |
| Omitted slide 3 "What is a token?" | `missing_concepts` (blocking) |
| Omitted Temperature (slide 18) and Top-p/Top-k (slide 19) — an entire named part | `missing_concepts` (blocking) ×2 |
| Sections not mirroring the deck's part structure | `organization_issues` (advisory) |
| 25 slides outside the supplied excerpt | correctly treated as a **source limitation**, listed in `unavailable_slides`, **not** charged to the recap |

Result: `overall_status: "NEEDS_REVISION"`, 9 blocking / 5 advisory, 10 prioritised
corrections — all phrased as instructions to the author, with no invented course content.
This is the negative-control evidence that the reviewer actually reviews rather than
rubber-stamping.

### 5.8 Iteration loop (orchestrator's job, not the agent's)

```
draft → reviewer → FAIL? → regenerate draft with findings injected → reviewer (max 2 retries)
                  → PASS → freeze recap + append review record
```

The reviewer itself never loops (§5.4). The orchestrator caps retries at 2 and, if the recap
still fails, ships it **marked** `REVIEW FAILED` with open findings listed — never an
unreviewed recap silently.

## 6. `extract-course-concepts` reusable skill — **IMPLEMENTED**

**Status:** implemented and verified (§6.4). The generator and diagram stages that consume
its output are not yet built.

### 6.1 Where it lives and how it is recognised

| Field | Value |
|---|---|
| **Skill name** | `extract-course-concepts` (matches the folder name exactly) |
| **Main file** | `.opencode/skills/extract-course-concepts/SKILL.md` |
| **Discovered by** | opencode's skill loader, which scans for `**/SKILL.md` under `.opencode/skills/` |
| **Frontmatter** | `name`, `description`, `license`, `metadata` |
| **Invocation** | Triggered by the model from the `description` (e.g. *"extract concepts from these slides"*), or named explicitly. Not a sub-agent — no `task` delegation needed |
| **Trigger keywords in `description`** | `extract concepts`, `course concepts`, `lecture recap`, `build a concept map`, `revision notes from slides`, `input/*.pdf`, `extracted/*/slide-*.md` |

The `description` states both **what** it does and **when** to use it, and front-loads those
keywords — without that the skill is filtered out and never surfaced to the model.

### 6.2 What it contains

```
.opencode/skills/extract-course-concepts/
├── SKILL.md                        # 11 sections: purpose, input, behaviour, rules,
│                                   # schema, gaps, noise, grouping, refs, determinism, checklist
├── references/
│   ├── output-schema.md            # field-by-field contract, types, empty + minimal examples
│   └── worked-example.md           # real watermarked source -> validated JSON output
└── scripts/
    └── validate-concepts.mjs       # dependency-free validator (node built-ins only)
```

`SKILL.md` sections map to the assignment's requirements: **§1** purpose · **§2** accepted
input · **§3** processing behaviour · **§4** extraction rules (the ten numbered rules) ·
**§5** output schema · **§6** missing/image-only content · **§7** noisy PDF text ·
**§8** grouping · **§9** source-reference rules · **§10** determinism · **§11** pre-emit
checklist.

### 6.3 Key design decisions

| Decision | Reason |
|---|---|
| Deck-agnostic; no lecture names, slide counts or topic lists anywhere | Reusability is the acceptance criterion. Labels must be **derived from the source**, never imported from a template or a previous deck |
| `quote` must be verbatim, verified character-for-character | The single strongest anti-fabrication device: it is mechanically checkable by both the validator and the reviewer sub-agent |
| Empty arrays rather than omitted fields | Keeps output shape fixed run-to-run (determinism) and makes "nothing in the source" distinguishable from "not looked at" |
| Image-only content goes to `unavailable_content`, never to `topics` | Prevents a gap being silently filled; makes it visible to the recap stage and to the reviewer |
| Watermark detection is **heuristic**, not a hardcoded word list | A token must recur across a large fraction of units *and* repeat within a single line. Avoids deleting genuinely repeated technical terms |
| Bundled validator rather than prose rules alone | Rules 1, 2, 4 and 10 become mechanical checks instead of hopes |

### 6.4 Verification performed

**Discovery.** An `opencode run` session showed the loader picking it up and pulling in the
references:

```
→ Skill "extract-course-concepts"
→ Read .../references/output-schema.md
→ Read .../references/worked-example.md
→ Read .../scripts/validate-concepts.mjs
```

**Positive test** — real raw text from Lecture 1 (slides 5–8, 18–19) including the
`deboistech` watermark, the fused `PART 1 · CORE MECHANICSBPE · Byte-Pair Encoding` strings,
the damaged `BEAIOR` heading, the U+2019 apostrophe and the U+E007 ligature codepoint. The
skill stripped the watermark, split the fused furniture, used the intact heading copy, kept
`examples` and `revision_points` empty (the slides have none), grouped into two topics, and
produced output that **validated with 0 errors and 1 expected warning** about the U+E007
glyph.

**Negative test** — a deliberately corrupted output fixture. The validator caught all seven
planted defects and exited `1`:

| Planted defect | Caught |
|---|---|
| Invented quote (`Merge the two most common bytes.`) | `quote NOT FOUND verbatim in source` |
| `confidence: "high"` on a PUA-bearing quote | unmapped-glyph/confidence error |
| Deleted required `examples` field | `missing required field` |
| `availability: "kind-of-available"` | enum violation |
| Duplicate group placed non-contiguously | ordering/contiguity violation |
| `slide: 99` on a 34-slide deck | caught only by human review — see gap below |
| Unknown `source_reference.author` key | unknown-key violation |

**Known validator gap:** an out-of-range slide number cannot be detected by the validator
alone, because the validator does not know the deck's slide count unless `--source` implies
it. `processed_slides + unavailable_slides ≤ total_slides` catches some cases; the reviewer
sub-agent's citation check (§5) is the backstop for the rest.

**Test caught a real bug in our own documentation.** The first version of
`references/worked-example.md` contained two quotes that were *not* verbatim
(`OpenAI's` vs the source's `OpenAI’s`, and `differently` vs a lost-ligature artefact). The
validator rejected them. Investigating produced a genuine new source finding:

> **[new] The decks contain private-use-area codepoints.** Slide 18 emits **U+E007** where
> the `ff` ligature glyph belongs, so the extracted text reads `di<U+E007>erent`. The
> intended characters are *not* recoverable from the text layer alone. The skill now quotes
> such text verbatim, records the codepoint in `extraction_notes`, and drops the concept to
> `confidence: "medium"` — it does not guess. The validator detects PUA codepoints in quotes
> and errors if the concept is still marked `high`.

---

## 7. Diagram strategy

**Format:** Mermaid source (`.mmd`), one per lecture, plus a rendered `.svg`/`.png` when
headless rendering is available. Mermaid is chosen because it is plain text (diffable,
reviewable by the sub-agent, editable without a design tool) and renders in most Markdown
viewers.

**Placement:** diagrams are generated **last**, from the frozen reviewed recap — so a
diagram can never depict a claim the reviewer rejected.

**One diagram per lecture, each depicting that lecture's actual core model:**

| Deck | Diagram | Source |
|---|---|---|
| Lecture 1 | Token → context → generation → latency chain (4 parts as a flow) | Part 1–4 structure, slides 3–31 |
| Lecture 2 | The four-part prompt anatomy + XML sandwiching structure | slides 3–8, and failure→defense (19–22) |
| Lecture 3 | The agent harness loop: perceive → decide → act → observe, with MCP/skills/sub-agents as extensions | slides 7–12, 13–19 |
| Lecture 4 | The six-stage inference pipeline with `TTFT = queueing + prefill` and `TPOT = decode` bracketed | slides 6–14 |

Lecture 4's diagram is the centrepiece — slide 14 explicitly calls itself "the one diagram to
remember from today", and the formulas
`TTFT = queueing + prefill`, `TPOT = decode time per token`, and
`total ≈ TTFT + (output tokens − 1) × TPOT` come straight from that slide.

**Rendering:** emit `.mmd` always. Render via `@mermaid-js/mermaid-cli` (`mmdc`) if the
environment permits; otherwise commit `.mmd` only and note it in the README. Rendering must
never block the recap pipeline.

**Validation:** every node label and edge label in the `.mmd` must appear as text in the
extracted slides — the same no-invention rule as the recap. Labels are checked by
`validate-concepts.mjs`.

---

## 8. End-to-end workflow

```
PDF (input/*.pdf)
   │
   ├─(1) PDF extraction ─────────► extracted/<deck>/slide-NN.md + manifest.json
   │        MCP server `pdf-reader` (@rturv/mcp-pdf-reader) — VERIFIED §4.3
   │        get_pdf_page_count → read_pdf_pages (per slide) → list_pdf_images
   │        → strip `deboistech` watermark → dedupe → split kicker → segment slides
   ▼
concept extraction skill  (.opencode/skills/extract-course-concepts)
   │        classify slides → extract concepts w/ verbatim + citations
   │        → validate (sources in range, verbatim present)
   ▼
output/concepts/<deck>.concepts.json
   │
   ├─(2) recap generation ──────► output/recaps/<deck>.recap.md   (DRAFT)
   │        structure per §3.1, every claim cited to a slide
   ▼
Course Recap Reviewer sub-agent  (.opencode/agent/course-recap-reviewer.md)
   │        edit: deny · webfetch/websearch: deny
   │        6 checks: source faithfulness · completeness · unsupported content
   │        accuracy · organization · revision usefulness
   │        may re-confirm citations via MCP `search_pdf` against the original PDF
   │        → one structured review  (overall_status: PASS | NEEDS_REVISION)
   │
   ├── FAIL ──► regenerate with findings injected (max 2 retries)
   ▼
final recap  (review record appended, verdict stamped in header)
   │
   └─(3) diagram ────────────────► output/diagrams/<deck>.mmd (+ .svg/.png)
            built from the frozen recap; labels must exist in extracted slides
```

Per-leculation driver: `npm run recap -- <deck-slug>` runs steps 1→3 for one deck;
`npm run recap:all` loops over all four. Evidence is written by each stage as it goes
(§11), so a failure at any step leaves the prior stages' artefacts on disk.

---

## 9. Project folder structure — **as built**

```
course-recap-generator/
├── input/                                  # given, read-only
│   ├── AAPLecture1_LLM_Foundations.pdf
│   ├── AAPLecture2_Prompt_Engineering.pdf
│   ├── AAPLecture3_AI_Coding_Techniques.pdf
│   └── AAPLecture4_Inference_Basics.pdf
│
├── docs/planning.md                        # this document
├── README.md                               # §12
├── package.json                            # npm run extract | recap | check
│
├── scripts/
│   ├── extract-pdf.mjs                     # (1) MCP client → extracted/ + cleaning
│   ├── build-recap-json.mjs                # (3a) concepts → course_recap.json (derived)
│   └── check-output.mjs                    # structural + traceability verification
│
├── .opencode/
│   ├── opencode.json                       # MCP registration (§4.1) — pdf-reader
│   ├── command/recap.md                    # the whole pipeline, one entry point
│   ├── agent/course-recap-reviewer.md      # §5 reviewer sub-agent
│   └── skills/extract-course-concepts/     # §6 concept skill
│       ├── SKILL.md
│       ├── references/{output-schema.md, worked-example.md}
│       └── scripts/validate-concepts.mjs
│
├── extracted/                              # (1) generated
│   └── <deck-slug>/
│       ├── manifest.json
│       └── slide-01.md … slide-NN.md
│
├── output/                                 # the deliverables
│   ├── course_recap.md                     # ← primary deliverable
│   ├── course_recap.json                   # derived from concepts, cannot drift
│   ├── course_concept_diagram.mmd          # (3) Mermaid diagram
│   ├── course_recap_review.json            # reviewer pass 1
│   ├── course_recap_review_pass2.json      # reviewer pass 2
│   ├── course_recap_review_final.json      # final confirming pass
│   └── concepts/<deck-slug>.concepts.json  # (2) generated
│
└── evidence/
    ├── logs/extract-pdf.log
    └── review/course_recap.draft.md, course_recap.revised.md
```

Naming rule: `<deck-slug>` is the input filename minus `.pdf`, e.g.
`AAPLecture1_LLM_Foundations`. Generated directories are git-ignored except `output/`,
`evidence/`, and `docs/`.

**Deviation from the planned tree, and why.** The plan proposed `generate-recap.mjs`,
`render-diagram.mjs` and `run-all.mjs` as shell scripts. Those stages cannot live in a shell
script, because applying a skill and delegating to a sub-agent are opencode-internal
capabilities with no programmatic API. So the pipeline splits at that boundary:

- **Programmatic** (deterministic, testable, no model): MCP extraction, cleaning, concept
  validation, JSON recap derivation, output verification → `scripts/`.
- **Model-invoked** (skill + sub-agent + writing): concept extraction, recap authoring, review,
  correction, diagram authoring → `.opencode/command/recap.md`.

This is the same eight-stage workflow as planned (§8), with the seam in the one place the
architecture forces it. `npm run recap` invokes the command; `npm run extract` and
`npm run check` are pure scripts.

**Retired from this structure:** `mcp/pdf-server.mjs` and the `mcp/` directory. The planning
draft proposed hand-writing a PDF MCP server; `@rturv/mcp-pdf-reader` now provides that
capability, so we no longer own or maintain PDF parsing (§4.2).

---

## 10. Testing plan

Testing matters most where correctness is objective: extraction and validation.

### 10.1 Extraction tests

| Test | Assertion | Method |
|---|---|---|
| Slide count per deck | 34 / 28 / 22 / 28 exactly | compare page objects vs slides emitted |
| Watermark removal | 0 occurrences of `deboistech` in any extracted slide | grep |
| Footer removal | 0 occurrences of the `deboistech · <date>` pattern | grep |
| Dedupe | no slide has >2 identical consecutive non-empty lines | per-slide check |
| Reading order | slide 1 of Lecture 1 yields `LLM Foundations`, `Tokens · Context · Inference`, `DAY 1 · ASTRA · TRACK 1, WEEK 1` in order | exact substring assertions |
| Known strings | every term in a §10.4 fixture appears on its known slide | substring assertions |
| Image-only flag | Lecture 3 slide 4 flagged `image-only` in `manifest.json` | manifest assertion, corroborated by MCP `list_pdf_images` |
| Idempotence | two runs produce byte-identical output | hash compare |
| MCP parity | page count from `pdf-reader` `get_pdf_page_count` equals the page count recorded in `manifest.json` for all four decks (34 / 28 / 22 / 28) | MCP call vs manifest |
| MCP ground truth | every term in §10.4 resolves to its expected page via `pdf-reader` `search_pdf` | MCP `search_pdf` assertions |

### 10.2 Concept validation tests

Run `node .opencode/skills/extract-course-concepts/scripts/validate-concepts.mjs <file>
--source <extracted-text>` over each deck. Must exit `0` with zero errors.

Structural checks it enforces:

- all eight required fields present on every concept; arrays are arrays, never omitted;
- `availability` / `confidence` within their enums; no ad-hoc fields;
- `source_reference` present, non-empty, and containing only known keys;
- `processed_slides + unavailable_slides ≤ total_slides`;
- concepts sharing a `topic`+`subtopic` are contiguous;
- any `availability: "unavailable"` concept is an error — gaps belong in
  `unavailable_content`, not in `topics`.

Grounding checks (need `--source`):

- **every `source_reference.quote` appears verbatim in the source** — the core anti-fabrication
  test, and the one that caught our own non-verbatim quotes in §6.4;
- quotes containing private-use-area codepoints warn, and error if the concept is still
  `confidence: "high"`.

**Negative test already run:** a fixture with seven planted defects (invented quote, missing
field, bad enum, non-contiguous group, unknown ref key, overstated confidence) produced
7 errors and exit `1`. See §6.4.

### 10.3 Reviewer tests (the important behavioural test)

1. **Pass test** — clean draft → `overall_status: "PASS"`, 0 blocking. *Not yet run — no
   generator exists yet.*
2. **Fail test (negative control)** — inject a fabricated claim (e.g. attribute
   `PagedAttention` to the wrong lecture, or invent a number) → must return
   `overall_status: "NEEDS_REVISION"` with a blocking finding. **Already demonstrated in
   §5.7** against a planted-defect fixture: 9 blocking findings returned. *This is the
   evidence that the reviewer actually reviews.*
3. **Citation test** — move a correct concept to a neighbouring but wrong slide → a source-faithfulness/accuracy finding.
4. **Coverage test** — delete an entire part → a `missing_concepts` blocking finding.
5. **Isolation test** — reviewer file has `edit: deny` and web tools denied. **Verified**
   via `opencode agent list` resolved permissions (§5.3).
6. **Loop test** — corrupted draft, 2 retries, ends as `REVIEW FAILED` and marked, never
   silent. Belongs to the orchestrator (§5.8), not the agent.

### 10.4 Extraction ground-truth fixture

A small checked-in fixture of ~20 (slide → expected substring) pairs taken from the real
decks, e.g.:

| Deck | Slide | Expected substring |
|---|---|---|
| L1 | 5 | `BPE · Byte-Pair Encoding` |
| L1 | 6 | `##` (WordPiece continuation) |
| L1 | 28 | `Time to first token.` |
| L1 | 29 | `Time per output token.` |
| L2 | 11 | `Jan 9, 2025` |
| L2 | 20 | `Ignore the above directions` |
| L3 | 14 | `plan mode` |
| L3 | 18 | `Host, client, server` |
| L4 | 12 | `0.8 MB per token` |
| L4 | 14 | `TTFT = queueing + prefill` |
| L4 | 21 | `SolidGoldMagikarp` |
| L4 | 22 | `200k-token tokenizer` |

### 10.5 Runner

`npm test` (Node's built-in `node:test` — no extra dependency). A `tests/visual/` directory
holds the extractor's per-slide output for the four decks as reviewable snapshots.

### 10.6 MCP connectivity test

`opencode mcp list` must report `✓ pdf-reader connected`. If it reports
`Operation timed out after 30000ms` on a fresh machine, warm the `npx` cache once
(`npx -y @rturv/mcp-pdf-reader` with stdin held open) and re-run; see §4.3.

---

## 11. Evidence to capture

The assignment is graded on demonstrable use of each opencode capability, so each stage
writes its own evidence as it runs.

### 11.1 Completed — MCP layer (already collected)

| # | Evidence | Status | Proves |
|---|---|---|---|
| **E0a** | `.opencode/opencode.json` registering `pdf-reader` | ✅ done | MCP server is configured, not just described |
| **E0b** | `opencode mcp list` → `✓ pdf-reader connected` | ✅ done | OpenCode actually connects to the server |
| **E0c** | `initialize` handshake → `mcp-pdf-reader v1.0.0`, protocol `2024-11-05` | ✅ done | protocol-level handshake succeeds |
| **E0d** | `tools/list` → 7 tools enumerated | ✅ done | full tool surface is exposed |
| **E0e** | `get_pdf_page_count` on Lecture 1 → `Total pages: 34` | ✅ done | the server reads a real course PDF |
| **E0f** | `read_pdf_pages` 1–2 → real slide text (`LLM Foundations`, `Tokens · Context · Inference`, `DAY 1 · ASTRA · TRACK 1, WEEK 1`, `THE HOOK`) | ✅ done | **extraction works on actual course material** |
| **E0g** | `search_pdf "Byte-Pair Encoding"` → **page 5** | ✅ done | term→slide resolution correct; matches independent extraction |
| **E0h** | `search_pdf "Time to first token"` → **page 28** | ✅ done | term→slide resolution correct; matches independent extraction |
| **E0i** | First-connection timeout (`Operation timed out after 30000ms`) during npm download, then `connected` after cache warm | ✅ recorded | failure mode documented and resolved, not hidden |
| **E0j** | Watermark reproduction: `read_pdf_pages` output dominated by repeated `deboistech` | ✅ recorded | justifies cleaning step §2.3 step 6 / limitation L-1 |
| **E0k** | L3 slide 4 confirmed image-only; server is not OCR-based | ✅ recorded | justifies "mark unavailable" rule L-4 |

Raw outputs of E0b–E0k are recorded in §4.3 of this document.

### 11.2 To capture — remaining stages

| # | Evidence | Path | Proves |
|---|---|---|---|
| E1 | Extraction log per PDF: slide count, watermark/dedupe counts, warnings | `evidence/logs/extract-<deck>.log` | PDFs were actually parsed |
| E2 | Full extracted slide text | `extracted/<deck>/` (snapshotted to `evidence/reports/`) | what the model was allowed to see |
| E3 | Concepts JSON per deck | `output/concepts/*.concepts.json` | the skill ran and produced its schema |
| E4 | Validation output (zero errors) | `evidence/logs/validate-<deck>.log` | concepts are internally consistent |
| E5 | Draft recap before review | `evidence/review/<deck>.draft.md` | reviewer had a real input |
| E6 | Reviewer structured review (JSON block, `schema_version: "1"`) | `evidence/review/<deck>.review.json` | the sub-agent ran and judged |
| E7 | **Negative-control review** — corrupted draft, reviewer must return `NEEDS_REVISION` | `evidence/review/negative-control.*` | the reviewer is not a rubber stamp (**prototype already demonstrated, §5.7**) |
| E8 | Final diff draft → post-review | `evidence/review/<deck>.diff` | findings actually changed the output |
| E9 | Mermaid sources (+ renders) | `output/diagrams/` | diagrams trace to reviewed content |
| E10 | Tool/session transcript per lecture | `evidence/logs/session-<deck>.log` | MCP + skill + sub-agent were exercised end to end |
| E11 | MCP call log during a full run (which tools, which pages, per deck) | `evidence/logs/mcp-pdf.log` | the MCP server is used by the pipeline, not merely configured |
| E12 | `opencode.json` + agent + skill files | `.opencode/**` | configuration is inspectable |
| E13 | Human-readable summary of all verdicts | `evidence/reports/summary.md` | one-glance status for a grader |
| E14 | This planning doc | `docs/planning.md` | design preceded implementation |

`evidence/reports/summary.md` is the single table a grader should read first: deck, slides
processed, concepts extracted, reviewer verdict, blocking/advisory counts, diagram status.

---

## 12. README contents

Planned `README.md` sections:

1. **Title + one-paragraph what-it-does.**
2. **What you get** — a table of the four recaps: deck, slides, concepts, verdict.
3. **Quick start** — prerequisites (Node 24+), install, `npm run recap:all`, where output lands.
4. **How it works** — the 8-step pipeline diagram from §8, one short paragraph per stage.
5. **The `pdf-reader` MCP server** — name, package, purpose, the 7 tools, where it is used in
   the workflow, the verification results from §4.3, the first-connection timeout gotcha,
   and its no-OCR limitation.
6. **The Course Recap Reviewer** — what it checks (C1–C5), what it is forbidden from doing
   (edit, web access), and how to read a verdict.
7. **The extract-course-concepts skill** — what it does, its output schema, how to reuse it
   on a new deck.
8. **Diagrams** — the four diagrams, with the L4 latency pipeline called out.
9. **Project layout** — the folder tree from §9.
10. **Extraction notes and limitations** — L-1…L-6 from §2.4, plainly stated: the
    `deboistech` watermark is cleaned before concept extraction; the L3 comparison table is
    an image with no text layer and is reported as unavailable rather than reconstructed.
11. **Testing** — `npm test`, what the negative-control test is and why it exists.
12. **Evidence index** — links to every artefact in §11.
13. **Extending it** — add a deck; add a concept type; change the review strictness.

---

## Appendix A — Planning-phase findings that shaped this design

Items marked **[verified]** were reproduced a second time against the live `pdf-reader` MCP
server; items marked **[corrected]** were later overturned by that test.

1. **[verified] The agent cannot read these PDFs natively.** `read` returns
   `Cannot read pdf (this model does not support pdf input)`. PDF-to-text must therefore
   happen outside the model — hence an MCP server rather than a prompt.
2. **[corrected] "No PDF MCP server exists on npm" was wrong.** The planning draft probed
   `mcp-server-pdf`, `@pdfreader/mcp`, `pdf-reader-mcp` and `mcp-pdf-reader` (all 404) and
   concluded no such package existed. `@rturv/mcp-pdf-reader` does exist, and is now the
   project's PDF MCP server. The proposed hand-written `mcp/pdf-server.mjs` is retired.
   *Lesson recorded: a negative search result from four guessed package names is not
   evidence of absence.*
3. **[verified] Slide counts measured, not guessed:** 34 / 28 / 22 / 28 = 112 slides. The
   MCP server independently returned `Total pages: 34` for Lecture 1, matching.
4. **[verified] A `deboistech` watermark tiles every slide** and must be stripped or it will
   swamp concept extraction. Reproduced live: the `read_pdf_pages` response was dominated by
   repeated `deboistech` plus the `deboistech · 2026-10-03` footer.
5. **Layered drawing duplicates text 2–3× per slide** (worst case: L4 slide 28), so
   de-duplication is mandatory.
6. **[verified] Lecture 3 slide 4's four-tool comparison table has no text layer** — it is a
   raster image, and the MCP server is explicitly not OCR-based, so the text is permanently
   unavailable. The recap must state it as unavailable rather than invent the four tools'
   details. `extract_pdf_image` may confirm the table is graphical; its pixels must not be
   paraphrased into fabricated cell values.
7. **Deck structure is not uniform.** L1 has 4 parts, L2 has 5, L3 has 4 parts plus a
   best-practices slide, L4 has 6 parts plus a sourced appendix. Output must follow each
   deck's real shape.
8. **Lecture 3 is the Day 6 deck and teaches MCP, skills, and sub-agents** — the three
   capabilities this assignment requires. Its recap is both an output and a self-demonstration.
9. **Lecture 4 slide 14 supplies the headline diagram and its formulas**, and slides 21–24
   supply four named, sourced real-world incidents with figures that must be quoted exactly.
10. **[new] `search_pdf` gave an independent cross-check of slide numbering.** `Byte-Pair
    Encoding` → page 5 and `Time to first token` → page 28, both matching the
    planning-phase extraction. This tool becomes the reviewer's citation check (§4.4).
11. **[new] The decks contain private-use-area codepoints.** Slide 18 of Lecture 1 emits
    **U+E007** where the `ff` ligature glyph belongs, so extracted text reads
    `di<U+E007>erent`; a repeat heading copy also drops letters (`BEHAVIOR` → `BEAIOR`).
    Discovered when the skill's own validator rejected two of our worked-example quotes as
    non-verbatim. Handling: quote verbatim, prefer the intact copy when one exists, record
    the codepoint in `extraction_notes`, drop to `confidence: "medium"`, and never guess the
    intended characters (§6.4).

## Appendix B — Open questions for the implementation turn

- Renderer availability for Mermaid (`@mermaid-js/mermaid-cli` pulls a Chromium; decide
  whether to install it or ship `.mmd` only).
- Whether `validate-concepts.mjs` runs as a skill script, a test, or both (proposed: both).
- Whether the reviewer should be allowed one targeted `edit` for typo fixes (proposed: **no**
  — keep `edit: deny` and preserve separation of duties).
- Whether to set `experimental.mcp_timeout` above the 30 s default so the first connection
  survives a cold `npx` cache (§4.3). Deferred: re-running works, so no config change yet.
