# Worked example

Built from real extracted text of a 34-slide lecture deck on LLM foundations. Reproduced
here to show noise handling, structure detection, and gap-marking. **The watermarked text
below is verbatim source**; the output is what the skill should emit from it.

---

## Input as received (verbatim, noise and defects included)

Reproduced **exactly** as the PDF text extraction produced it — watermarks, fused headings,
a dropped heading letter (`BEAIOR`), a curly apostrophe, and a lost ligature all included.

`----- SLIDE 5 -----`
```
PART 1 · CORE MECHANICS
PART 1 · CORE MECHANICSBPE · Byte-Pair Encoding
PART · CORE MECANICSBPE · Byte-Pair EncodingMerge the most frequent pair. Repeat.
PART 1 · CORE MECHANICS
deboistech deboistech deboistech deboistech deboistech deboistech
deboistech · 2026-10-03
```

`----- SLIDE 6 -----`
```
PART 1 · CORE MECHANICS
PART 1 · CORE MECHANICSWordPiece
PART · CORE MECANICSWordPieceGreedy longest match. ## marks a continuation.
deboistech deboistech deboistech deboistech
deboistech · 2026-10-03
```

`----- SLIDE 7 -----`
```
PART 1 · CORE MECHANICS
PART 1 · CORE MECHANICSSentencePiece
PART · CORE MECANICSSentencePieceWorks on raw text. A space is just a symbol.
deboistech deboistech deboistech deboistech
deboistech · 2026-10-03
```

`----- SLIDE 8 -----`
```
PART 1 · CORE MECHANICS
PART 1 · CORE MECHANICStiktoken
PART · CORE MECANICStiktokenOpenAI’s fast byte-level BPE.
deboistech deboistech deboistech deboistech
deboistech · 2026-10-03
```

`----- SLIDE 18 -----`
```
PART 2 · GENERATION BEHAVIOR
PART 2 · GENERATION BEHAVIORTemperature
PART · GENERATION BEAIORTemperatureSame prompt, di<?>erent randomness.
deboistech deboistech deboistech deboistech
deboistech · 2026-10-03
```

`<<?>>` marks **U+E007**, a private-use-area codepoint the PDF font emits for the `ff`
ligature glyph. It is a placeholder here only for legibility; the real bytes at that position
are `64 69 EE 80 87 65` (`d`, `i`, U+E007, `e`, …). In the JSON below the same character is
written as the escape `\uE007`, which parses to the exact codepoint.

`----- SLIDE 19 -----`
```
PART 2 · GENERATION BEHAVIOR
PART 2 · GENERATION BEHAVIORTop-p · Top-k
PART · GENERATION BEAIORTop-p · Top-kWhich tokens are even allowed next.
deboistech deboistech deboistech deboistech
deboistech · 2026-10-03
```

---

## What the skill did

1. **Stripped noise.** `deboistech` recurs on every slide *and* repeats many times within a
   single line → watermark, removed. The `deboistech · 2026-10-03` footer → removed, but
   the slide number is kept as the reference. `PART 1 · CORE MECHANICS` appears **once**
   (after collapse) and repeats *across* slides → running kicker, so it becomes `section`,
   not noise.
2. **Split fused furniture.** `PART 1 · CORE MECHANICS` + `BPE · Byte-Pair Encoding`
   became `section` + `key_concept` rather than one string.
3. **Preferred the intact heading.** Slides 5–8 and 18–19 each carry the heading twice, once
   cleanly (`PART 1 · CORE MECHANICS`) and once damaged (`BEAIOR`). The clean copy is used.
   Nothing is guessed — one intact instance is present.
4. **Quoted verbatim, including the damage.** Two source defects are unmappable from the
   text layer alone:
   - slide 8 uses U+2019 (`OpenAI’s`), not ASCII `'`;
   - slide 18 contains **U+E007**, a private-use-area codepoint standing in for the `ff`
     ligature glyph, so the source reads `di<U+E007>erent`.

   Both are reproduced verbatim in `quote`, defects included, because a quote that cannot be
   found in the source is a bug. Neither is silently corrected: the intended characters are
   a matter of inference, and rule 7 forbids filling gaps that way. Each is reported in
   `extraction_notes`, and the affected concept drops to `confidence: "medium"`.
5. **Emitted no examples or revision points**, because these slides contain none. Inventing
   a BPE example would have been a rule-2 violation.

---

## Output

```json
{
  "schema_version": "1",
  "source": {
    "identifier": "AAPLecture1_LLM_Foundations",
    "kind": "slide_deck",
    "total_slides": 34,
    "processed_slides": 6,
    "unavailable_slides": []
  },
  "noise_handling": {
    "ignored_patterns": ["deboistech"],
    "notes": "Stripped tiled 'deboistech' watermark and repeated 'deboistech · 2026-10-03' footer. Running kicker repeated across slides retained as section, not treated as noise. 6 of 34 slides supplied as excerpt."
  },  "topics": [
    {
      "topic": "PART 1 · CORE MECHANICS",
      "subtopic": "Tokenizers",
      "key_concept": "BPE · Byte-Pair Encoding",
      "explanation": "A tokenization method that merges the most frequent pair, then repeats that merge.",
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
    },
    {
      "topic": "PART 1 · CORE MECHANICS",
      "subtopic": "Tokenizers",
      "key_concept": "WordPiece",
      "explanation": "Uses greedy longest match; ## marks a continuation.",
      "examples": [],
      "important_terms": ["WordPiece", "##"],
      "revision_points": [],
      "source_reference": {
        "slide": 6,
        "section": "PART 1 · CORE MECHANICS",
        "quote": "Greedy longest match. ## marks a continuation."
      },
      "availability": "available",
      "confidence": "high"
    },
    {
      "topic": "PART 1 · CORE MECHANICS",
      "subtopic": "Tokenizers",
      "key_concept": "SentencePiece",
      "explanation": "Works on raw text, where a space is just a symbol.",
      "examples": [],
      "important_terms": ["SentencePiece"],
      "revision_points": [],
      "source_reference": {
        "slide": 7,
        "section": "PART 1 · CORE MECHANICS",
        "quote": "Works on raw text. A space is just a symbol."
      },
      "availability": "available",
      "confidence": "high"
    },
    {
      "topic": "PART 1 · CORE MECHANICS",
      "subtopic": "Tokenizers",
      "key_concept": "tiktoken",
      "explanation": "OpenAI's fast byte-level BPE.",
      "examples": [],
      "important_terms": ["tiktoken", "byte-level BPE"],
      "revision_points": [],
      "source_reference": {
        "slide": 8,
        "section": "PART 1 · CORE MECHANICS",
        "quote": "OpenAI’s fast byte-level BPE."
      },
      "availability": "available",
      "confidence": "high"
    },
    {
      "topic": "PART 2 · GENERATION BEHAVIOR",
      "subtopic": "Sampling controls",
      "key_concept": "Temperature",
      "explanation": "Controls randomness: the same prompt can give different results.",
      "examples": [],
      "important_terms": ["Temperature"],
      "revision_points": [],
      "source_reference": {
        "slide": 18,
        "section": "PART 2 · GENERATION BEHAVIOR",
        "quote": "Same prompt, di\uE007erent randomness."
      },
      "availability": "available",
      "confidence": "medium"
    },
    {
      "topic": "PART 2 · GENERATION BEHAVIOR",
      "subtopic": "Sampling controls",
      "key_concept": "Top-p · Top-k",
      "explanation": "Determines which tokens are even allowed next.",
      "examples": [],
      "important_terms": ["Top-p", "Top-k"],
      "revision_points": [],
      "source_reference": {
        "slide": 19,
        "section": "PART 2 · GENERATION BEHAVIOR",
        "quote": "Which tokens are even allowed next."
      },
      "availability": "available",
      "confidence": "high"
    }
  ],
  "unavailable_content": [],
  "extraction_notes": [
    "Topic and subtopic labels derived from the source's own part headings; 'Tokenizers' and 'Sampling controls' are inferred subtopic labels, as the source supplies only parts.",
    "Source defect: slide 8 uses U+2019 in 'OpenAI’s'; quoted verbatim, not normalised.",
    "Source defect: slide 18 contains U+E007 (private use) where the ff ligature glyph should be. The quote reproduces that codepoint; the intended characters are not recoverable from the text layer without guessing.",
    "Slides 1-4 and 9-17 were not supplied in this excerpt and were not assessed.",
    "Slides 1, 2 and the deck's recap/quiz/next-up slides are decoration-only and yielded no concepts."
  ]
}
```

---

## Gap-marking example (image-only)

A different deck in the same course has a comparison table rendered as an image on slide 4,
with no text layer. Correct handling — note what is **absent**:

```json
{
  "location": "slide 4",
  "kind": "image_only_table",
  "note": "Four-tool comparison table rendered as an image; no text layer. Cell contents not recovered and deliberately not reconstructed.",
  "adjacent_text_used": "Comparison at a glance / Strength and typical use, one line each."
}
```

The slide number also appears in `source.unavailable_slides`.

**Incorrect handling**, for contrast — all of these violate the rules:

- Naming the four tools, because the deck's other slides mention some of them.
- Describing the table's axes or columns from the picture.
- Writing `"kind": "image_only_table"` but still emitting a `key_concept` describing the
  table's contents.
- Leaving it out of `unavailable_content` entirely, so the gap is invisible downstream.

A downstream recap must say this table was not readable. It must not reconstruct it.
