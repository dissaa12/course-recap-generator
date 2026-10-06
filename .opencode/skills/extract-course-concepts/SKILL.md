---
name: extract-course-concepts
description: >-
  Use when turning course source material - lecture slide PDFs, extracted slide text,
  lecture notes or transcripts - into a consistent structured concept set for revision.
  Extracts topic, subtopic, key_concept, explanation, examples, important_terms,
  revision_points and source_reference per concept, grounded strictly in the supplied
  source with slide/page references. Triggers on "extract concepts", "course concepts",
  "lecture recap", "build a concept map", "revision notes from slides", and on files named
  input/*.pdf or extracted/*/slide-*.md. Never invents content and marks image-only or
  unavailable material instead of filling it in.
license: MIT
metadata:
  version: "1"
  output_schema_version: "1"
---

# Extract Course Concepts

Turn course source material into a structured, revision-oriented concept set.

You are a **transcriber of structure**, not an author. Your job is to find the concepts
that are actually in the source and record them in a consistent shape so a student can
revise from the result. You do not teach, expand, embellish, or supply anything the source
does not contain.

This skill is **deck-agnostic**. It works on any course PDF. Never assume a topic list, a
deck name, a slide count, a section-naming scheme, or an ordering — derive all of it from
the material you are given.

---

## 1. Purpose

Produce, from raw course source content, a single JSON document that:

- preserves the source's own terminology and ordering,
- groups related concepts under topic and subtopic,
- keeps an auditable pointer (lecture / slide / page / section) back to where each concept
  came from,
- flags anything you could not read instead of guessing at it,
- is byte-stable for identical input, so it can be diffed and re-run.

---

## 2. Accepted input

Any one of:

| Input | Notes |
|---|---|
| A PDF path | Read it with the configured PDF MCP server (e.g. `read_pdf_pages` per slide, `get_pdf_page_count` for the total). Never rely on a built-in file reader that cannot parse PDFs |
| Extracted per-slide text files | `slide-01.md`, `slide-02.md`, … or any files naming their slide number |
| A single concatenated text blob | Use `slide N` markers or page-break markers if present to recover positions |
| A concepts/notes record (JSON or text) | Re-extract from it, preserving its existing references |

Also accept, if supplied alongside the source:

- a **manifest** giving total slide count and any slides known to be unreadable,
- a **review or findings file** naming problems from a previous run — fix these and say so
  in `extraction_notes`.

**Slide numbering.** Use the source's own numbering, 1-based, matching what a reader sees.
Never renumber. If the source provides no numbering, number sequentially in the order
content appears and record that fact in `extraction_notes`.

---

## 3. Processing behavior

Work in this order. Do not reorder or skip stages.

1. **Establish extent.** Determine `total_slides` (or page/topic count) and how much you
   could actually read. Record unreadable portions in `source.unavailable_slides`.
2. **Clean each unit of text** — remove noise (§7) *before* interpreting anything.
3. **Detect the source's own structure.** Look for section headings, numbered parts,
   running headers, dividers, or repeated label prefixes (for example a running kicker
   line). When they exist, they are your topic and subtopic skeleton.
4. **Segment** the cleaned content into per-slide units, keeping each unit's reference.
5. **Extract concepts** from each unit (§4).
6. **Group** into topic → subtopic → key_concept (§8).
7. **Mark gaps** — image-only or otherwise unreadable content (§6).
8. **Validate** against §9 and the schema in `references/output-schema.md`. Run
   `node scripts/validate-concepts.mjs <output.json> --source <source-text>` when you can.

**One concept per substantive idea.** A slide carrying one idea yields one concept. A slide
carrying several distinct ideas yields one concept each. Title slides, dividers, section
headers, quiz prompts and "next up" slides yield **no** concept — record them in
`extraction_notes` instead.

---

## 4. Extraction rules

These are absolute. They override any urge to be helpful or complete-looking.

1. **Source-only.** Use only information present in the supplied source content. Nothing
   from your own knowledge, nothing from earlier decks, nothing you believe is true in
   general.
2. **Never invent.** If a concept, example, figure, date, name or definition is not in the
   source, it does not go in the output. An empty field is correct; a plausible invention
   is a failure.
3. **Preserve terminology.** Use the source's words for concepts, terms, mechanisms and
   named things. If the source calls it `top-p`, do not write "nucleus sampling". If you add
   a connective word for readability, nothing else changes.
4. **Quote, don't paraphrase, in `source_reference.quote`.** Keep it a short verbatim
   fragment (a phrase, a clause, a figure) — never a whole slide.
5. **Explanations restate and connect, never extend.** An `explanation` may unpack or
   connect only what the source already says. It must not add a mechanism, a benefit, a
   caveat, or an implication the source does not make.
6. **Examples only if the source has them.** `examples` comes from worked examples, demos,
   sample prompts, sample outputs, or concrete instances present in the source. Never
   manufacture a plausible example. If none exist, emit `[]`.
7. **`important_terms`** are terms the source itself introduces, names, or uses as headings.
   Include a term only if the source supports it.
8. **`revision_points`** are the source's own statements of importance — its takeaways,
   recaps, cautions, warnings, and emphasised conclusions. If the source has no recap or
   takeaway slide, derive them only from what the source itself flags; otherwise leave
   `[]`. Do not manufacture study advice.
9. **Do not silently fill gaps.** Never use general knowledge to complete a partial
   definition, a truncated sentence, or a missing table.
10. **Deterministic output.** Same input ⇒ same concepts, same wording, same order, same
    references. See §10 for ordering.

---

## 5. Output schema

Emit **one** JSON document. Full field specification, types and an empty example:
`references/output-schema.md`. A worked example built from real source material:
`references/worked-example.md`.

Top-level shape:

```json
{
  "schema_version": "1",
  "source": {
    "identifier": "<deck / lecture / document identifier>",
    "kind": "slide_deck",
    "total_slides": 0,
    "processed_slides": 0,
    "unavailable_slides": []
  },
  "noise_handling": {
    "ignored_patterns": [],
    "notes": ""
  },
  "topics": [
    {
      "topic": "",
      "subtopic": "",
      "key_concept": "",
      "explanation": "",
      "examples": [],
      "important_terms": [],
      "revision_points": [],
      "source_reference": {
        "lecture": "",
        "slide": 0,
        "page": 0,
        "section": "",
        "quote": ""
      },
      "availability": "available",
      "confidence": "high"
    }
  ],
  "unavailable_content": [
    {
      "location": "",
      "kind": "",
      "note": "",
      "adjacent_text_used": ""
    }
  ],
  "extraction_notes": []
}
```

The eight required fields are `topic`, `subtopic`, `key_concept`, `explanation`,
`examples`, `important_terms`, `revision_points`, `source_reference`. `availability`,
`confidence`, `unavailable_content` and `extraction_notes` support the gap-marking and
determinism rules.

**Emit the JSON, not prose.** You may add at most three short lines before or after it
(`Notes:`) for anything a human should know. No commentary on the concepts themselves.

---

## 6. Missing and image-only content

When a slide, table or figure carries **no extractable text** — it is a raster image, a
photograph, a chart whose labels were flattened, or a diagram whose text did not survive
extraction:

1. **Never invent its contents**, and never infer them from the surrounding prose.
2. Add an entry to `unavailable_content`:

   ```json
   {
     "location": "slide 4",
     "kind": "image_only_table",
     "note": "Table rendered as an image; no text layer. Contents not recovered.",
     "adjacent_text_used": ""
   }
   ```

   `kind` is one of `image_only_table`, `image_only_diagram`, `image_only_figure`,
   `no_text_layer`, `empty_slide`, `truncated_text`. `adjacent_text_used` quotes any
   readable text on the same slide that you *did* use — leave `""` if none.
3. Add the slide number to `source.unavailable_slides`.
4. If the surrounding slide has other readable text, extract concepts from **that** text
   and set `availability: "available"` — but never let the concept imply it covers the
   unreadable part. Say so in `extraction_notes`.
5. If the whole deck is unreadable, still emit a valid document: empty `topics`, the full
   `unavailable_slides` list, and a note. Do not return nothing.

If an image-extraction tool is available you may use it to **confirm** that content is
graphical. Its pixels are not a transcription — do not describe or paraphrase an image's
contents into concept fields.

---

## 7. Noisy PDF text

Slide decks extracted from PDFs carry artefacts. Clean these **before** interpreting, or
they will corrupt concepts and references.

| Artefact | Symptom | Handling |
|---|---|---|
| **Repeated watermark / background word** | One token repeating many times per line and on every slide, e.g. `deboistech` | Strip. `noise_handling.ignored_patterns` should record it |
| **Footer / running header** | A repeated `brand · date` or `Brand — Page N` line on every slide | Strip, but keep the slide number as the reference |
| **Duplicated lines** | The same sentence 2–3× on one slide, from layered text drawing | Collapse identical consecutive lines; record the count |
| **Concatenated furniture** | Heading and title fused, e.g. `PART 1 · CORE MECHANICSWhat is a token?` | Split into `section` and `key_concept` using the heading vocabulary |
| **Damaged repeated heading** | The running heading appears twice, once intact and once with letters dropped, e.g. `GENERATION BEHAVIOR` and `BEAIOR` | Use the intact copy. Never reconstruct the damaged one |
| **Curly vs straight punctuation** | `OpenAI’s` (U+2019) vs `OpenAI's` | Keep the source's character in `quote`. Normalise only inside `explanation` |
| **Private-use codepoint** | A character from U+E000–U+F8FF where a ligature glyph belongs, e.g. `di<U+E007>erent` (ff) or `A<U+E009>ention` (tt) | **Unrecoverable from the text layer — do not guess.** Quote verbatim, record the codepoint in `extraction_notes`, and set `confidence: "medium"` |
| **Interleaved reading order** | Text from different boxes mixed on one line | Group by position if available; otherwise keep source order and do not infer false adjacency |
| **Ligatures that did survive** | `ﬁ`, `ﬂ` | These *are* decodable — normalise them. Distinguish from the private-use case above, which is not |
| **Bullet glyphs / stray control chars** | `•`, ``, `\t` | Normalise to plain text |
| **Decoration-only slides** | Title, divider, thank-you, quiz, "next up" | No concept. Note them in `extraction_notes` |

**Detecting a watermark generically.** Do not rely on a hardcoded list. A watermark is a
short token that (a) recurs on a large fraction of units, and (b) repeats **three or more
times within a single line**. Both conditions must hold. The threshold of three is
deliberate: furniture printed twice on a slide (`PART 1 · CORE MECHANICS` appearing on two
lines) yields two occurrences and is content, not noise.

`scripts/validate-concepts.mjs` applies exactly this heuristic automatically and prints the
tokens it detected on its `watermark:` line. Pass `--noise <pattern>` to add an explicit
override when a source's watermark cannot be detected this way.

**Never strip a term just because it repeats.** A genuinely repeated technical term
(for example, `KV cache` across many slides) is content. Strip only text that is
repetitive *within* a line and pervasive *across* units.

---

## 8. Grouping

- **`topic`** — a major area of the material, named from the source's own section headings
  where they exist, otherwise clustered from content. Examples of the right granularity:
  a named part, a chapter, a coherent block of slides.
- **`subtopic`** — a cluster within the topic, usually one heading grouping or one
  mechanism family. May equal `topic` when the source offers no finer level.
- **`key_concept`** — the single idea, phrased in the source's terminology, one per entry.

Rules:

- Derive labels **from the source**, never from a template or another deck. If the source
  has no headings, infer labels from its actual subject matter and say in
  `extraction_notes` that labels were inferred.
- Concept entries with the same `topic` **and** `subtopic` must be contiguous in the array.
- A concept appearing to belong to two topics goes under its primary one; mention the
  cross-link in `revision_points` or `extraction_notes` only if the source supports it.

---

## 9. Source-reference rules

1. **Keep the pointer.** Every concept carries `source_reference` with whatever the source
  provides: `lecture`, `slide`, `page`, `section`, `quote`.
2. **Omit, do not fabricate.** If the source has no lecture label, omit `lecture`. Never
   invent a lecture number, deck name, date or URL. `slide` / `page` may be `0` when the
   source genuinely provides no numbering — but prefer `null` over a wrong number.
3. **Use the reader's numbering**, 1-based, as the source presents it.
4. **`quote` must be verbatim** from that unit and short. Verify it character-for-character
   against the source before emitting — including apostrophe style and any extraction damage
   the source carries. A quote you cannot find in the source is a bug: remove it rather than
   approximate it. If the intended word is unrecoverable (see §7, lost ligature), quote the
   damaged text and record it in `extraction_notes`; never write the word you think was meant.
5. **`section`** holds the source's own heading text for the unit, verbatim.
6. **Confidence** reflects evidence, not plausibility:
   - `high` — the concept is stated explicitly and unambiguously in the source.
   - `medium` — stated but terse, or split across adjacent units.
   - `low` — the source is fragmentary. Prefer recording `availability` and a note instead
    of forcing a `low` confidence concept.

---

## 10. Determinism

- **Ordering.** `topics` in source order of first appearance. Concepts within a
  topic/subtopic in source order. `unavailable_content` in slide order.
- **No re-derivation drift.** Same input file ⇒ byte-identical output. Do not vary wording,
  field presence, or ordering between runs.
- **Field presence is fixed.** Emit every required field on every concept, using `[]` for
  empty lists. Do not omit empty fields, and do not add fields ad hoc.
- **Self-consistency.** `processed_slides + unavailable_slides` must reconcile with
  `total_slides`; a concept may not be marked `availability: "unavailable"` (gaps belong in
  `unavailable_content`); concepts sharing a `topic`+`subtopic` must be contiguous.
- **Validate before emitting.** Run
  `node scripts/validate-concepts.mjs <file> --source <source-text>` if you can write files.
  Fix every error it reports rather than describing the problem.

---

## 11. Before you emit — checklist

- [ ] Every concept traces to something in the source.
- [ ] No invented concept, example, figure, date, name or definition.
- [ ] Source terminology preserved in `key_concept` and `important_terms`.
- [ ] Every `source_reference.quote` verified verbatim.
- [ ] Watermark / footer noise stripped and recorded in `noise_handling.ignored_patterns`.
- [ ] Duplicated lines collapsed.
- [ ] Every unreadable unit listed in `unavailable_content` and `source.unavailable_slides`.
- [ ] Nothing in the output reads as if an unreadable visual had been read.
- [ ] Topics contiguous, ordering in source order.
- [ ] All eight required fields present on every concept.
- [ ] Validator passes with zero errors.
