// Extracts every task of every bootcamp module as plain text for the quality check:
// task text, options, hints, the stored check (onclick code and data objects from the
// script) and, for gates, the decoded correct option. Runs the modules in headless Chrome
// with MathJax blocked, so formulas stay readable as LaTeX.
//
// Usage: node tools/qualitaet/extrahieren.mjs [ModuleId ...]  -> tools/qualitaet/out/aufgaben.json
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PW = process.env.PLAYWRIGHT_CORE || "/Users/malteohlsen/Poolzeit/node_modules/playwright-core";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { chromium } = require(PW);

const args = process.argv.slice(2);
const modules = args.length ? args : readdirSync(join(ROOT, "src")).filter((d) => !d.startsWith(".")).sort();

// Runs inside the page.
function extractInPage() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CANVAS", "TEMPLATE"]);
  const BLOCK = /^(DIV|P|LI|UL|OL|TR|TABLE|SECTION|H[1-6]|LABEL|BR|FIELDSET|DETAILS|SUMMARY|HEADER|NAV|BUTTON)$/;
  const CHECK = /check|pruef|submit|pick|select|selOpt|mcSelect|toggleCheck|evaluat/i;
  function text(node) {
    let out = "";
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); return; }
      if (n.nodeType !== 1 || SKIP.has(n.tagName)) return;
      const cls = (n.getAttribute("class") || "");
      if (n.tagName === "svg" || n.tagName === "SVG") {
        const t = Array.from(n.querySelectorAll("text")).map((x) => x.textContent.trim()).filter(Boolean);
        out += t.length ? ` [Grafik mit Beschriftung: ${t.join(", ")}] ` : " [Grafik] ";
        return;
      }
      if (n.tagName === "INPUT") {
        const ty = n.getAttribute("type") || "text";
        if (ty === "radio" || ty === "checkbox") out += ` (Option value=${n.value}) `;
        else if (ty === "hidden") return;
        else out += " [Eingabefeld] ";
        return;
      }
      if (n.tagName === "TEXTAREA") { out += " [Textfeld] "; return; }
      if (n.tagName === "SELECT") { out += " [Auswahl: " + Array.from(n.options).map((o) => o.textContent.trim()).join(" / ") + "] "; return; }
      const block = BLOCK.test(n.tagName);
      if (block) out += "\n";
      if (/hint|tipp/i.test(cls)) out += "Tipp: ";
      if (/solution|loesung|musterl/i.test(cls)) out += "Musterlösung: ";
      for (const c of n.childNodes) walk(c);
      const oc = n.getAttribute("onclick") || n.getAttribute("onchange") || "";
      if (oc && CHECK.test(oc)) out += ` [Code: ${oc.trim()}] `;
      for (const a of n.getAttributeNames()) if (/^data-(answer|correct|solution|value|accept)/.test(a)) out += ` [${a}=${n.getAttribute(a)}] `;
      if (block) out += "\n";
    };
    walk(node);
    return out.replace(/[ \t]+/g, " ").replace(/ *\n[ \n]*/g, "\n").trim();
  }
  const scripts = Array.from(document.scripts).map((s) => s.textContent).join("\n");
  // Balanced {...} or [...] after "key:" in the script source.
  function dataFor(key) {
    const re = new RegExp("(^|[\\s,{])(['\"]?)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\2\\s*:\\s*([\\[{])", "g");
    const found = [];
    let m;
    while ((m = re.exec(scripts)) && found.length < 3) {
      let i = m.index + m[0].length - 1, depth = 0, inStr = null;
      const open = scripts[i], close = open === "{" ? "}" : "]";
      const start = i;
      for (; i < scripts.length; i++) {
        const ch = scripts[i];
        if (inStr) { if (ch === "\\") i++; else if (ch === inStr) inStr = null; continue; }
        if (ch === "'" || ch === '"' || ch === "`") inStr = ch;
        else if (ch === open) depth++;
        else if (ch === close && --depth === 0) break;
      }
      found.push(key + ": " + scripts.slice(start, i + 1).slice(0, 2500));
    }
    return found;
  }
  // Gate answer decoding: try every option value against the stored hash.
  function decodeGate(qi, card) {
    try {
      // eslint-disable-next-line no-undef
      const H = typeof HASHES !== "undefined" ? HASHES : null, S = typeof SALT !== "undefined" ? SALT : "";
      const f = typeof fnv1a === "function" ? fnv1a : null;
      if (!H || !f) return null;
      const ok = (v) => f("q" + qi + ":" + v + S) === H[qi - 1];
      const vals = Array.from(card.querySelectorAll("input[type=radio]")).map((r) => r.value);
      let hit = vals.filter(ok);
      if (hit.length) return hit;
      // Arrow on the grid: answer string "sx,sy>dx,dy"
      const defs = typeof BOARD_DEFS !== "undefined" ? BOARD_DEFS : null;
      if (defs && defs[qi]) {
        const b = defs[qi];
        for (let sx = 0; sx <= b.w; sx++) for (let sy = 0; sy <= b.h; sy++)
          for (let ex = 0; ex <= b.w; ex++) for (let ey = 0; ey <= b.h; ey++) {
            const v = `${sx},${sy}>${ex - sx},${ey - sy}`;
            if (ok(v)) return ["Pfeil mit Fuß bei (" + sx + "|" + sy + ") und Verschiebung (" + (ex - sx) + "|" + (ey - sy) + ") Kästchen; Gitter-Daten: " + JSON.stringify(b)];
          }
      }
      // Number input: answers are normalized with String(parseFloat(...))
      if (card.querySelector("input:not([type=radio]):not([type=hidden])")) {
        for (let k = -200000; k <= 200000; k++) { const v = String(parseFloat((k / 100).toFixed(2))); if (ok(v)) return ["Zahl " + v]; }
        for (let k = -100000; k <= 100000; k++) if (ok(String(k * 10))) return ["Zahl " + k * 10];
      }
      return "nicht entschlüsselbar (Texteingabe)";
    } catch (e) { return null; }
  }

  const SEL = ".exercise-card, .exercise, .q-card, .task-card";
  let cards = Array.from(document.querySelectorAll(SEL)).filter((c) => !c.parentElement.closest(SEL));
  const items = [];
  const screenOf = (c) => c.closest(".screen, .module-screen, [id^=screen-], [id^=mod-], .tab-pane, section") || document.body;
  const explainCache = new Map();
  function explanation(c) {
    const s = c.closest(".screen, [id^=screen-mod], [id^=screen-]") || document.body;
    if (explainCache.has(s)) return explainCache.get(s);
    const clone = s.cloneNode(true);
    clone.querySelectorAll(SEL).forEach((x) => x.remove());
    const t = text(clone).slice(0, 5000);
    explainCache.set(s, t);
    return t;
  }
  cards.forEach((c, idx) => {
    const t = text(c);
    if (t.length < 20) return;
    const keys = new Set();
    const codes = (t.match(/\[Code: [^\]]*\]/g) || []).join(" ");
    for (const m of codes.matchAll(/\(\s*(\d+)\s*,\s*(\d+)/g)) keys.add(`'${m[1]}-${m[2]}'`.slice(1, -1));
    for (const m of codes.matchAll(/'([a-z]{1,4}\d{1,2})'/g)) keys.add(m[1]);
    const idm = (c.id || "").match(/^m(\d+)-ex(\d+)$/);
    if (idm) keys.add(`${idm[1]}-${idm[2]}`);
    c.querySelectorAll("[id]").forEach((e) => { const m = e.id.match(/^(?:board|fbd|rows)-([a-z]{1,4}\d{1,2})$/); if (m) keys.add(m[1]); });
    let daten = [];
    for (const k of keys) daten.push(...dataFor(k));
    const qm = (c.id || "").match(/^qc?(\d+)$/);
    const gate = qm ? decodeGate(+qm[1], c) : null;
    items.push({ nr: idx + 1, id: c.id || null, screen: (screenOf(c).id || ""), text: t.slice(0, 6000), daten: daten.join("\n\n").slice(0, 6000), gateLoesung: gate, erklaerung: explanation(c) });
  });
  // Placement test: cards live in the CARDS data object, not in the DOM.
  try {
    // eslint-disable-next-line no-undef
    if (!cards.length && typeof CARDS !== "undefined") {
      const intro = text(document.body).slice(0, 3000);
      for (const [track, list] of Object.entries(CARDS)) list.forEach((c, i) => {
        const m = typeof META !== "undefined" && META[track] ? META[track].name : track;
        const opts = (c.opts || []).map((o, j) => `(Option ${j}) ${o}`).join("\n");
        const loes = c.correct !== undefined ? `Hinterlegte richtige Option: ${c.correct}` : "";
        items.push({ nr: items.length + 1, id: `${track}${i + 1}`, screen: `Track ${track} (${m})`,
          text: `Selbsteinschätzung (${c.level}): ${c.question}\nKontrollaufgabe (${c.taskType}): ${c.taskText || ""}\n${opts}\n${loes}`,
          daten: JSON.stringify(c).slice(0, 4000), gateLoesung: null, erklaerung: intro });
      });
    }
  } catch (e) {}
  const title = document.title;
  const whole = items.length ? null : text(document.body).slice(0, 20000);
  return { title, items, whole };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
await ctx.route(/mathjax|googleapis|gstatic/i, (r) => r.abort());
const result = {};
for (const m of modules) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(pathToFileURL(join(ROOT, "src", m, "index.html")).href);
  await page.waitForTimeout(800);
  const r = await page.evaluate(extractInPage);
  r.fehler = errs;
  result[m] = r;
  console.log(`${m.padEnd(16)} ${String(r.items.length).padStart(3)} Aufgaben${r.whole ? " (ohne Aufgabenkarten, Gesamttext)" : ""}${errs.length ? "  JS-Fehler: " + errs[0].slice(0, 80) : ""}`);
  await page.close();
}
await browser.close();
const out = join(ROOT, "tools", "qualitaet", "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "aufgaben.json"), JSON.stringify(result, null, 1), "utf8");
