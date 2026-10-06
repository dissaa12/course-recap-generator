# Course Recap Generator

Turns lecture slide PDFs into a **source-cited, independently reviewed** course recap and a
concept relationship diagram.

Built for the Day 6 assignment, "Course Recap Generator" — four slide decks, 112 slides, one
reviewed recap. Every claim in the output traces to a slide. Content that cannot be read from
the PDFs is reported as unreadable rather than filled in.

---

## 1. Purpose

Given lecture PDFs, this project produces:

| Output | What it is |
|---|---|
| `output/course_recap.md` | The readable recap: course overview, deck overview, topics, key concepts, technical points, examples, revision points, source references, and an explicit limitations section |
| `output/course_recap.json` | The same content, machine-readable, derived from the concept files so it cannot drift |
| `output/course_concept_diagram.mmd` | A Mermaid concept relationship diagram, every label traceable to an extracted concept |

Along the way it produces `extracted/<deck>/slide-NN.md` (cleaned per-slide text),
`extracted/<deck>/manifest.json`, and `output/concepts/<deck>.concepts.json`.

## 2. Setup

**Requirements:** Node 20+ and `opencode`. No project dependencies to install — the scripts use
Node built-ins only.

```bash
node --version      # v20 or newer
opencode --version
```

Put the PDFs in `input/`. The MCP server is fetched on first run through `npx` and cached
afterwards.

## 3. How the MCP is configured

The agent's built-in `read` tool **cannot** open PDFs — it returns
`Cannot read pdf (this model does not support pdf input)`. This project therefore supplies that
capability with one MCP server.

`.opencode/opencode.json`:

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

| | |
|---|---|
| **Server name** | `pdf-reader` |
| **Package** | `@rturv/mcp-pdf-reader` v1.0.0 (MIT) |
| **Purpose** | PDF text extraction, page ranges, term→page search, page counts, image listing |
| **Used at** | Stage 1 (extraction) and by the reviewer for citation cross-checks |

Seven tools are available: `read_pdf`, `read_pdf_pages`, `search_pdf`,
`get_pdf_page_count`, `get_pdf_metadata`, `list_pdf_images`, `extract_pdf_image`.

Verify it is connected:

```bash
opencode mcp list        # expect: ✓ pdf-reader connected
```

**First-run gotcha.** The first connection can fail with
`Operation timed out after 30000ms`, because opencode's MCP connect window is 30 s and `npx` is
still downloading the package. Warm the cache and retry:

```bash
npx -y @rturv/mcp-pdf-reader   # run once, let it sit, then cancel
opencode mcp list              # now connected
```

`scripts/extract-pdf.mjs` reports this explicitly and fails with a readable message if the
server cannot start.

## 4. How the custom skill works

`.opencode/skills/extract-course-concepts/` — a reusable OpenCode skill.

```
SKILL.md                        # purpose, input, behaviour, rules, schema, gaps, noise, determinism
references/output-schema.md     # field-by-field contract
references/worked-example.md    # real watermarked source -> validated JSON
scripts/validate-concepts.mjs   # dependency-free validator
```

The skill turns raw slide text into a concept set with eight required fields per concept:
`topic`, `subtopic`, `key_concept`, `explanation`, `examples`, `important_terms`,
`revision_points`, `source_reference`.

Three rules do the real work:

1. **Source-only.** Nothing from outside the supplied material. An empty `examples: []` is
   correct; a plausible invention is a failure.
2. **Quotes must be verbatim**, character-for-character. This is what makes fabrication
   mechanically detectable — the validator re-checks every quote against the source.
3. **Gaps are declared, not filled.** Image-only or unreadable content goes to
   `unavailable_content`, never into `topics`.

It is **deck-agnostic**: topic and subtopic labels are derived from whatever headings the
source has. Across the four decks it produced completely different label sets without
modification — `PART 1 · CORE MECHANICS / Tokenizers` for Lecture 1 versus
`PART 3 · INSIDE THE ENGINE / KV cache` for Lecture 4. No lecture name, slide count or topic
list appears anywhere in the skill.

Validate any concept file:

```bash
node .opencode/skills/extract-course-concepts/scripts/validate-concepts.mjs \
  output/concepts/AAPLecture4_Inference_Basics.concepts.json \
  --source extracted/AAPLecture4_Inference_Basics
```

## 5. How the Course Recap Reviewer works

`.opencode/agent/course-recap-reviewer.md` — a declared sub-agent.

```yaml
mode: subagent
temperature: 0.1
permission:
  edit: deny          # it reports, it never rewrites
  webfetch: deny      # no outside knowledge
  websearch: deny
```

Invoke it via the task tool:

```
task(subagent_type: "course-recap-reviewer",
     description: "Review course recap against source",
     prompt: "Review output/course_recap.md against the source-derived material in
              extracted/ and output/concepts/. Return the structured review.")
```

> `opencode run --agent course-recap-reviewer` will warn that it is a subagent, not a primary
> agent, and fall back. Delegate through the task tool instead.

It runs **six checks** in a fixed order — source faithfulness, completeness, unsupported
content, accuracy, organization, revision usefulness — and returns one structured review:
`overall_status` (`PASS` or `NEEDS_REVISION`), `missing_concepts`, `unsupported_claims`,
`inaccurate_claims`, `organization_issues`, `revision_usefulness_issues`,
`recommended_corrections`, and a `counts` block. The verdict is mechanical: any `blocking`
finding means `NEEDS_REVISION`.

It never edits the recap and never invents replacement content — corrections are instructions
to the author. It runs a single pass; retries are the orchestrator's job.

## 6. How to run the generator

**One command, whole pipeline:**

```bash
opencode run --command recap
```

Or stage by stage:

```bash
npm run extract        # stage 1: MCP extraction + cleaning -> extracted/
npm run recap          # stages 2-7: skill, recap, review, corrections, diagram
npm run check          # verify the outputs
```

Stage 1 alone, for one deck:

```bash
npm run extract -- --deck AAPLecture1_LLM_Foundations
npm run extract:list   # show detected decks
```

## 7. Output files

```
output/
├── course_recap.md               # the readable recap          <- primary deliverable
├── course_recap.json             # machine-readable recap
├── course_concept_diagram.mmd    # Mermaid concept diagram
├── course_recap_review.json      # reviewer pass 1
├── course_recap_review_pass2.json
├── course_recap_review_final.json
└── concepts/<deck>.concepts.json # per-deck concept sets

extracted/<deck>/
├── manifest.json                 # slide counts, detected watermark, image counts
└── slide-01.md … slide-NN.md     # cleaned per-slide text

evidence/
├── logs/extract-pdf.log          # extraction log
└── review/course_recap.draft.md  # draft as first reviewed

docs/planning.md                  # design document
```

`npm run check` verifies the outputs: all files present, all eight required recap sections, all
146 slide references in range, extraction limitations disclosed, all 118 diagram labels traced
back to an extracted concept, and a reviewer verdict recorded.

## 8. Limitations

**Read from the actual run — not hypothetical.**

- **Lecture 3 is largely graphical.** 21 of its 22 slides carry a raster diagram, table or card
  grid with no text layer. Only kickers, titles and one-line subtitles were extractable
  (40–91 characters per slide). The **four-tool comparison table** (slide 4), the
  **best-practice checklist items** (slide 20) and the **seven recap ideas** (slide 21) were
  **not recovered** and are absent from the recap. This is the single largest gap.
- **Unmapped glyphs.** The PDFs emit private-use-area codepoints (`U+E007`, `U+E009`) where
  ligature glyphs belong, so some characters are not recoverable from the text layer — e.g.
  `A<U+E009>ention` for "Attention" on L4 slide 11. These are quoted verbatim and never
  reconstructed; affected concepts carry `confidence: "medium"`. Three words are spelled
  normally in the recap for readability and are flagged inline in §8 of the recap.
- **No OCR.** The MCP server is explicitly not OCR-based. Image-only slides cannot be recovered
  by retrying.
- **Watermark noise.** Every slide carries a tiled `deboistech` watermark and footer, stripped
  automatically. Detection is data-derived (a short token on ≥40% of slides at ≥3× per slide),
  not a hardcoded word list.
- **Navigation and quiz slides are not summarised.** L1 slide 33 (Kahoot), L4 slide 28
  (appendix sources), and the next-up previews extract cleanly but carry no teaching content.
- **The reviewer cannot read images.** It can confirm a slide is *declared* unavailable, but it
  cannot independently prove an image-only claim. Those rest on the extraction manifest and the
  concept records.
- **`sharding`** is named only in Lecture 4's recap slide and explained nowhere, so no concept
  was created for it.

## 9. Example end-to-end workflow

A real run on the four PDFs in `input/`:

```
1. node scripts/extract-pdf.mjs
     spawns pdf-reader MCP over stdio
     get_pdf_page_count  -> 34 / 28 / 22 / 28 slides
     read_pdf_pages      -> per-slide text
     list_pdf_images     -> per-slide image counts
     clean: watermark-only lines, footers, page markers, duplicate lines
     -> extracted/<deck>/slide-NN.md + manifest.json

2. extract-course-concepts skill, once per deck
     -> output/concepts/<deck>.concepts.json
     validated: 0 errors across all four (29 / 24 / 18 / 26 concepts)

3. recap generation
     -> output/course_recap.md  (8 required sections, 145 slide references)

4. course-recap-reviewer sub-agent
     pass 1  -> NEEDS_REVISION, 5 blocking, 11 advisory
     pass 2  -> NEEDS_REVISION, 5 blocking
     final   -> NEEDS_REVISION, 1 blocking  (14 earlier corrections verified applied; 1 new blocking finding corrected)

5. corrections applied (each blocking finding re-verified against the slides first)

6. diagram -> output/course_concept_diagram.mmd  (118 labels, all traced)

7. npm run check -> PASSED
```

**Result:** 112 slides → 97 concepts → 1 reviewed recap + 1 diagram. 15 blocking findings
raised across three passes, all corrected. No fabricated content; the largest unrecoverable
item (Lecture 3's comparison table) is explicitly reported as unavailable.

## 10. Assignment requirement mapping

| # | Requirement | Where it lives | Evidence |
|---|---|---|---|
| 1 | **Plan before building** | `docs/planning.md` | Design, extraction strategy, agent/skill designs, testing plan, risks — updated after each stage |
| 2 | **Use an MCP server** | `.opencode/opencode.json` | `pdf-reader` = `@rturv/mcp-pdf-reader`; `opencode mcp list` → connected; 7 tools listed |
| 3 | **PDF content extraction via MCP** | `scripts/extract-pdf.mjs` | JSON-RPC MCP client over stdio; page counts 34/28/22/28 verified against the server |
| 4 | **Clean extraction noise** | `scripts/extract-pdf.mjs` | Data-derived watermark detection; 3,696 watermark lines + 112 footers removed; 0 residual |
| 5 | **Reusable custom skill** | `.opencode/skills/extract-course-concepts/` | Run on 4 decks unmodified; produced 4 different label sets; validator 0 errors |
| 6 | **Structured course recap** | `output/course_recap.md` + `.json` | 8 required sections; 145 slide references; JSON generated from concepts so it cannot drift |
| 7 | **Reviewer sub-agent** | `.opencode/agent/course-recap-reviewer.md` | `opencode agent list` → `course-recap-reviewer (subagent)`; 3 passes, 15 blocking findings |
| 8 | **Apply reviewer corrections** | `output/course_recap.md` §9 | 15 corrections itemised with the action taken for each, across 3 review passes |
| 9 | **Concept diagram** | `output/course_concept_diagram.mmd` | Mermaid `flowchart TD`; all 118 labels traced to extracted concepts by `npm run check` |
| 10 | **Save final outputs** | `output/` | recap, json, diagram, reviews, per-deck concepts |
| 11 | **Simple way to run it** | `package.json`, `.opencode/command/recap.md` | `npm run extract` · `npm run recap` · `npm run check` |
| 12 | **Tested on the real PDFs** | `evidence/` | Full run on all 4 PDFs in `input/`; no mock output anywhere |
| 13 | **Never invent information** | `SKILL.md` §4, reviewer C1/C4, `npm run check` | Image-only content reported unavailable; 15 blocking findings caught and fixed |
| 14 | **Documentation** | this file, `docs/planning.md` | Setup, MCP, skill, reviewer, usage, outputs, limitations, workflow, requirement map |

## 11. Licence and provenance

Code and documentation in this project are original. All course content is derived from the
four PDFs supplied in `input/`, which remain the property of their authors; the recap quotes
and paraphrases them with per-slide attribution. Lecture 4 cites its own external sources
(LessWrong, MIT Technology Review, Anthropic Engineering, the vLLM team) and marks its figures
"as reported".