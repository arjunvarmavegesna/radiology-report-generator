# Data cleanup notes

These are one-time data-handling decisions made while tagging all 21 templates,
so future maintainers know why things are the way they are.

## File moves performed by `scripts/tag-templates.ts`

The tagger script moves two filled patient reports out of `Templates/` (where
they didn't belong) into the appropriate `Approved  data/` category folders.
The moves are idempotent — re-running the tagger is safe.

| From (originally in `Templates/`) | To |
|---|---|
| `M. Nagadurga  NT scan.docx` | `Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo/M. Nagadurga NT scan.docx` |
| `Ultrasound neck.docx` | `Approved  data/Thyroid neck/Ultrasound neck (ENT referral).docx` |

`Ultrasound neck.docx` is **not** a duplicate of `Ultra sound thyroid neck.docx` —
it's a real patient thyroid report (Ref. Dr. A Suma Devi, ENT) that was
misfiled. The rename in the destination flags its source so a future reader
isn't confused.

## In-memory compliance injection (early-pregnancy templates)

The source `.docx` files for `early_pregnancy` and `early_pregnancy_no_fhr`
do **not** carry the bilingual PC&PNDT compliance block in their bodies,
unlike the seven other obstetric templates (NT scan, NT twins, TIFFA, TIFFA
twins, growth, growth twins, fetal echo).

To keep all OB exports legally consistent, the tagger reads the compliance
block from `Templates/growth template.docx` once at startup and splices it
in **in memory**, just before the signature paragraph, when tagging the two
early-pregnancy templates. The source `.docx` files on disk are **not
modified**. The block ends up in `data/templates-tagged/early_pregnancy*.tagged.docx`
and survives docxtemplater rendering verbatim.

If the clinic ever updates the canonical compliance wording, edit
`Templates/growth template.docx` once and re-run the tagger — all 9 OB
templates pick up the change.

## Open item — `Approved  data/neurosonogram/` (2 reports)

There's no `neurosonogram` entry in `lib/scan-types.ts` and no neurosonogram
template in `Templates/`. The 2 approved reports sit there as historical
data only; they cannot be created/exported through the app until a
neurosonogram scan type is added (Phase 3 candidate).

## Word lock files

`Templates/~$*.docx` files are temporary owner-lock files that Word leaves
when a document is open. They're harmless and can be deleted with
`rm Templates/~$*.docx`. They'll reappear if those source `.docx` files are
opened in Word again.
