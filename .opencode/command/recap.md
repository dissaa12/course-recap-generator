---
description: Run the full Course Recap Generator pipeline over the PDFs in input/ (extract → skill → recap → reviewer → corrections → diagram).
agent: build
---

# Course Recap Generator — full pipeline

Run the whole pipeline over every PDF in `input/`. Execute the stages in order, one clean
pass each. Do **not** open a retry loop: if a stage fails, report it and stop.

## Stage 1 — PDF extraction (script)

```bash
node scripts/extract-pdf.mjs
```

Spawns the `pdf-reader` MCP server (`@rturv/mcp-pdf-reader`) over stdio, reads every PDF via
`get_pdf_page_count` / `read_pdf_pages` / `list_pdf_images`, applies the cleaning rules, and
writes `extracted/<deck>/slide-NN.md` + `manifest.json`.

Skip if `extracted/*/manifest.json` already exists and is newer than `input/`.

## Stage 2 — concept extraction (skill), once per deck

For each deck in `extracted/`:

1. Read `extracted/<deck>/manifest.json` and report slide count, watermark fragments and
   low-text slides before doing anything else.
2. Read `extracted/<deck>/slide-*.md`.
3. Apply the `extract-course-concepts` skill. Emit **only** its JSON document, written to
   `output/concepts/<deck>.concepts.json`.
4. Validate and fix until clean:

   ```bash
   node .opencode/skills/extract-course-concepts/scripts/validate-concepts.mjs \
     output/concepts/<deck>.concepts.json --source extracted/<deck>
   ```

   Zero errors required. Warnings must be addressed in `extraction_notes` or fixed.

## Stage 3 — course recap draft

Read all `output/concepts/*.concepts.json` plus the four `manifest.json` files. Write
`output/course_recap.md` and `output/course_recap.json` containing exactly these sections:

1. **Course overview** — what the course covers, across all decks.
2. **Lecture / deck overview** — one row per deck: title, day/track if stated, slide count.
3. **Topics covered** — grouped by deck, then topic, then subtopic.
4. **Key concepts** — the concepts themselves, with definitions.
5. **Important technical points** — mechanisms, numbers, and constraints stated in the source.
6. **Examples found in the source** — only examples actually present. Write "None found in
   the source." where there are none.
7. **Quick revision points** — the source's own takeaways and cautions.
8. **Source references** — slide/page pointers throughout, plus an extraction-limitations
   section naming image-only and low-text slides.

Rules: never invent; never fill image-only content; preserve source terminology; keep every
slide reference; state extraction limitations explicitly.

## Stage 4 — review (sub-agent)

Delegate to the `course-recap-reviewer` sub-agent via the task tool:

```
task(subagent_type: "course-recap-reviewer",
     description: "Review course recap against source",
     prompt: "Review output/course_recap.md against the source-derived material in
              extracted/ and output/concepts/. Source: input/*.pdf via the pdf-reader MCP
              server. Return the structured review.")
```

## Stage 5 — apply corrections

Write the draft to `evidence/review/course_recap.draft.md` first, so the before/after diff is
available.

Apply reviewer findings that are `blocking`, and any `advisory` that improves source
fidelity. **Never** apply a correction by inventing course content — if the reviewer asks for
material the source does not contain, record it as a known gap instead.

Save the reviewer JSON to `output/course_recap_review.json`.

## Stage 6 — diagram

Write `output/course_concept_diagram.mmd`: a Mermaid concept-relationship diagram built
**only** from concepts present in `output/concepts/*.concepts.json`. Every node label must be a
term that appears in a concepts file. Prefer `flowchart TD` with one subgraph per deck.

## Stage 7 — report

Print a table: deck, slides, concepts, reviewer verdict, blocking, advisory. Then list the
output files written.