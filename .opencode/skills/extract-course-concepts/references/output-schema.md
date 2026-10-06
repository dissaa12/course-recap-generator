# Output schema — `extract-course-concepts` (schema_version "1")

One JSON document per source. Emit the JSON object itself, not a description of it.

## Top level

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | string | yes | always `"1"` |
| `source` | object | yes | provenance of what was read |
| `noise_handling` | object | yes | what PDF noise was removed |
| `topics` | array | yes | the concept entries; may be `[]` |
| `unavailable_content` | array | yes | unreadable regions; may be `[]` |
| `extraction_notes` | array[string] | yes | decoration-only slides, inferred labels, prior-review fixes |

### `source`

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | deck / lecture id from the source or filename. Never invented |
| `kind` | string | `slide_deck`, `lecture_notes`, `transcript`, `article` |
| `total_slides` | integer | total slides or pages in the source |
| `processed_slides` | integer | slides actually read and used |
| `unavailable_slides` | array[integer] | slide numbers with no usable text |

`processed_slides + unavailable_slides` should reconcile with `total_slides`.

### `noise_handling`

| Field | Type | Notes |
|---|---|---|
| `ignored_patterns` | array[string] | watermark / background tokens stripped, e.g. `["deboistech"]` |
| `notes` | string | duplicate-line collapses, ligature repairs, footer stripping |

---

## Concept entry

The eight required fields, in this order:

| # | Field | Type | Rule |
|---|---|---|---|
| 1 | `topic` | string | major area, named from the source's own headings |
| 2 | `subtopic` | string | cluster within the topic; may equal `topic` |
| 3 | `key_concept` | string | the single idea, in the source's terminology |
| 4 | `explanation` | string | concise restatement/connection of what the source says. No additions |
| 5 | `examples` | array[string] | only examples present in the source; `[]` if none |
| 6 | `important_terms` | array[string] | terms the source introduces or heads a unit with |
| 7 | `revision_points` | array[string] | the source's own takeaways / cautions; `[]` if none |
| 8 | `source_reference` | object | pointer back into the source — see below |

Supporting fields:

| Field | Type | Notes |
|---|---|---|
| `availability` | string | `available` \| `partial` \| `unavailable` |
| `confidence` | string | `high` \| `medium` \| `low` |

### `source_reference`

| Field | Type | Notes |
|---|---|---|
| `lecture` | string | omit if the source has no lecture label |
| `slide` | integer | 1-based, as a reader sees it; omit if the source has no numbering |
| `page` | integer | include only if it differs from or is expressed differently to `slide` |
| `section` | string | the source's own heading text, verbatim |
| `quote` | string | short verbatim fragment; verified character-for-character |

### `unavailable_content`

| Field | Type | Notes |
|---|---|---|
| `location` | string | e.g. `"slide 4"` |
| `kind` | string | `image_only_table`, `image_only_diagram`, `image_only_figure`, `no_text_layer`, `empty_slide`, `truncated_text` |
| `note` | string | what could not be read. No description of the unseen content |
| `adjacent_text_used` | string | readable text from the same unit that you did use; `""` if none |

---

## Empty but valid document

Use this when the source is wholly unreadable. Returning nothing is a failure; this is a
correct answer.

```json
{
  "schema_version": "1",
  "source": {
    "identifier": "example-deck",
    "kind": "slide_deck",
    "total_slides": 22,
    "processed_slides": 0,
    "unavailable_slides": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]
  },
  "noise_handling": { "ignored_patterns": ["deboistech"], "notes": "Watermark stripped." },
  "topics": [],
  "unavailable_content": [
    {
      "location": "slides 1-22",
      "kind": "no_text_layer",
      "note": "No extractable text on any slide. Nothing to extract.",
      "adjacent_text_used": ""
    }
  ],
  "extraction_notes": ["All slides unreadable; emitted an empty concept set rather than guessing."]
}
```

## Minimal populated entry

```json
{
  "topic": "Example topic from the source's own heading",
  "subtopic": "Example subtopic",
  "key_concept": "Term exactly as the source uses it",
  "explanation": "What the source says this is, in one or two sentences.",
  "examples": ["Only if the source shows one"],
  "important_terms": ["Term", "OtherTerm"],
  "revision_points": ["Only if the source flags it"],
  "source_reference": {
    "slide": 5,
    "section": "VERBATIM HEADING",
    "quote": "short verbatim fragment"
  },
  "availability": "available",
  "confidence": "high"
}
```
