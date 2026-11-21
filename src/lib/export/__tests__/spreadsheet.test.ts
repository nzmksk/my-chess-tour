import { describe, expect, it } from "vitest";
import { crc32 as nodeCrc32 } from "node:zlib";
import { toCsv, toXlsx } from "../spreadsheet";

describe("toCsv", () => {
  it("starts with a BOM and ends every row with CRLF", () => {
    expect(
      toCsv([
        ["a", "b"],
        [1, 2],
      ]),
    ).toBe("﻿a,b\r\n1,2\r\n");
  });

  it("quotes cells holding commas, quotes or line breaks", () => {
    const csv = toCsv([['Tan, "Ali"', "line\nbreak", "plain"]]);
    expect(csv).toBe('﻿"Tan, ""Ali""","line\nbreak",plain\r\n');
  });

  it("writes null and undefined as empty cells", () => {
    expect(toCsv([[null, undefined, 0]])).toBe("﻿,,0\r\n");
  });

  it.each(["=1+1", "+60123", "-2", "@SUM(A1)", "\tx"])(
    "defuses text a spreadsheet would run as a formula: %j",
    (text) => {
      expect(toCsv([[text]])).toBe(`﻿'${text}\r\n`);
    },
  );

  it("leaves negative numbers alone", () => {
    expect(toCsv([[-5]])).toBe("﻿-5\r\n");
  });
});

function unzip(bytes: Uint8Array): Map<string, { text: string; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const entries = new Map<string, { text: string; crc: number }>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    expect(view.getUint16(p + 10, true)).toBe(0);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLen;
    const data = bytes.subarray(start, start + size);
    expect(nodeCrc32(data)).toBe(crc);

    entries.set(name, { text: decoder.decode(data), crc });
    p += 46 + nameLen;
  }
  return entries;
}

describe("toXlsx", () => {
  const rows = [
    ["#", "Name", "FIDE ID"],
    [1, 'Ålice <Tan> & "Co"', 5701234],
    [2, "=HYPERLINK()", null],
  ];

  it("packs a complete workbook with valid checksums", () => {
    const entries = unzip(toXlsx(rows));
    expect([...entries.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("writes numbers as numbers and text as escaped inline strings", () => {
    const sheet = unzip(toXlsx(rows)).get("xl/worksheets/sheet1.xml")!.text;
    expect(sheet).toContain('<c r="A2"><v>1</v></c>');
    expect(sheet).toContain('<c r="C2"><v>5701234</v></c>');
    expect(sheet).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">Ålice &lt;Tan&gt; &amp; &quot;Co&quot;</t></is></c>',
    );
    expect(sheet).toContain(">=HYPERLINK()</t>");
    expect(sheet).not.toContain("<f>");
    expect(sheet).not.toContain('r="C3"');
  });

  it("bolds the header row and freezes it", () => {
    const sheet = unzip(toXlsx(rows)).get("xl/worksheets/sheet1.xml")!.text;
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).not.toContain('<c r="A2" s="1"');
    expect(sheet).toContain('state="frozen"');
  });

  it("strips characters XML forbids", () => {
    const sheet = unzip(toXlsx([["a\u0000b\u0007c"]])).get(
      "xl/worksheets/sheet1.xml",
    )!.text;
    expect(sheet).toContain(">abc</t>");
  });

  it("names columns past Z", () => {
    const wide = [Array.from({ length: 28 }, (_, i) => i)];
    const sheet = unzip(toXlsx(wide)).get("xl/worksheets/sheet1.xml")!.text;
    expect(sheet).toContain('r="Z1"');
    expect(sheet).toContain('r="AA1"');
    expect(sheet).toContain('r="AB1"');
  });

  it("makes the sheet name one Excel accepts", () => {
    const workbook = unzip(
      toXlsx(rows, "KL Open: Rapid [2026] / Under-18 Championship"),
    ).get("xl/workbook.xml")!.text;
    const name = /<sheet name="([^"]*)"/.exec(workbook)![1];
    expect(name).toBe("KL Open  Rapid  2026    Under-1");
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it("is byte-for-byte reproducible", () => {
    expect(toXlsx(rows)).toEqual(toXlsx(rows));
  });
});
