#!/usr/bin/env node
// Build script for the Physik Bootcamp SCORM packages.
//
// Reads module sources from src/<ModuleId>/ (imsmanifest.xml + index.html),
// validates them and packs them as SCORM 1.2 zips into packages/ under the
// frozen file names defined in modules.json. The file names must never
// change: Moodle pulls them via fixed raw.githubusercontent.com URLs.
//
// The zip output is fully deterministic (fixed timestamps, stable entry
// order, fixed compression level), so rebuilding unchanged sources produces
// byte-identical zips and clean git diffs.
//
// Usage: node build.mjs [ModuleId ...]   (no args = build all)

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "packages");

// Fixed DOS timestamp (2026-01-01 00:00:00) for deterministic output.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

// ---------------------------------------------------------------- crc32
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------ zip writer
// Minimal ZIP writer: local headers + central directory + EOCD, deflate.
function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "ascii");
    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/attrs all 0
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBuf, compressed);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// ------------------------------------------------------------ validation
function validateModule(id, files) {
  const names = files.map((f) => f.name);
  if (!names.includes("index.html")) throw new Error(`${id}: index.html fehlt`);
  if (!names.includes("imsmanifest.xml")) throw new Error(`${id}: imsmanifest.xml fehlt`);

  const manifest = files.find((f) => f.name === "imsmanifest.xml").data.toString("utf8");
  if (!manifest.includes("<manifest") || !manifest.includes("</manifest>"))
    throw new Error(`${id}: imsmanifest.xml ist kein gültiges Manifest`);
  if (!manifest.includes('href="index.html"'))
    throw new Error(`${id}: imsmanifest.xml referenziert index.html nicht`);

  const html = files.find((f) => f.name === "index.html").data.toString("utf8");
  if (!/<\/html>\s*$/i.test(html)) throw new Error(`${id}: index.html endet nicht mit </html> (abgeschnitten?)`);
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      const line = html.slice(0, i).split("\n").length;
      throw new Error(`${id}: Steuerzeichen U+${c.toString(16).padStart(4, "0")} in index.html Zeile ${line} (kaputtes LaTeX-Escape?)`);
    }
  }
}

// ------------------------------------------------------------------ main
const modules = JSON.parse(readFileSync(join(ROOT, "modules.json"), "utf8"));
const only = process.argv.slice(2);
let built = 0, unchanged = 0;

for (const [id, zipNames] of Object.entries(modules)) {
  if (only.length && !only.includes(id)) continue;
  const dir = join(SRC, id);
  if (!existsSync(dir)) throw new Error(`Quellordner fehlt: src/${id}`);

  const files = readdirSync(dir)
    .sort()
    .map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  validateModule(id, files);

  const zip = buildZip(files);
  for (const zipName of zipNames) {
    const target = join(OUT, zipName);
    if (existsSync(target) && readFileSync(target).equals(zip)) {
      unchanged++;
      continue;
    }
    writeFileSync(target, zip);
    built++;
    console.log(`gebaut: ${zipName} (${zip.length} Bytes)`);
  }
}

console.log(`Fertig: ${built} Paket(e) neu gebaut, ${unchanged} unverändert.`);
