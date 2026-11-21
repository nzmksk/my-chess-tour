# 0004. Spreadsheet exports are hand-written CSV and XLSX

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Organizers export rosters of a few hundred rows. A spreadsheet library would
be a large dependency for that, and most of them can write formulas, which is
the last thing a file built from player-typed names should contain.

## Decision

`src/lib/export/spreadsheet.ts` writes both formats itself, with no
dependencies. The first row is always the header.

**CSV** (`toCsv`) is RFC 4180 with CRLF line endings and a UTF-8 byte-order
mark, without which Excel reads non-ASCII names as mojibake. A text cell that
starts with `=`, `+`, `-`, `@`, tab or CR (`FORMULA_TRIGGER`) would be read as
a formula ("CSV injection"), so it's prefixed with `'`, which spreadsheets
show as plain text. Numbers are written as they are.

**XLSX** (`toXlsx`) is the smallest Office Open XML workbook that Excel,
LibreOffice, Google Sheets and Numbers all open: one sheet of inline strings
and numbers, and a bold header (cell style 1 in `STYLES_XML`) frozen so it
stays visible while scrolling. There's no formula support, so no cell can ever
be evaluated. Characters XML 1.0 forbids (`INVALID_XML_CHARS`) are stripped,
because Excel refuses a file containing one. Sheet names are cut to Excel's
31 characters and lose `: \ / ? * [ ]`.

The workbook is packed by `zipStored`: every entry stored uncompressed, file
names flagged UTF-8 (`0x0800`), with the header layouts of PKWARE's APPNOTE
(local file header 4.3.7, central directory header 4.3.12, end of central
directory 4.3.16). Entry times are fixed at the DOS epoch (1980-01-01 00:00),
so the output is byte-for-byte reproducible; nothing reads them. There's no
ZIP64, whose 4 GiB threshold a roster never approaches.

## Consequences

- No dependency to audit or update, and no formula path to exploit.
- Large or styled exports would outgrow this; at that point a library is the
  better trade.
