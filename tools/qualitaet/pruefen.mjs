// Quality check of the bootcamp with Google "Gemini Decisions" (gemini-decision-1), following
// the Poolzeit decisions check (~/Poolzeit/core/qualitaet.mjs). Pre-filter, not a verdict:
// every finding is looked at before anything is changed. Only course content goes to the API.
//
// Usage: node tools/qualitaet/pruefen.mjs [ModuleId ...] [--gegenprobe]
// Needs tools/qualitaet/out/aufgaben.json (extrahieren.mjs) and GEMINI_API_KEY.
// Writes out/funde.json and keeps a request cache in out/cache.json.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const API = "https://generativelanguage.googleapis.com/v1beta/decisions";
const MODELL = "gemini-decision-1";
const key = (process.env.GEMINI_API_KEY || "").trim();
if (!key) { console.log("GEMINI_API_KEY fehlt."); process.exit(0); }

const args = process.argv.slice(2);
const gegenprobe = args.includes("--gegenprobe");
const nurModule = args.filter((a) => !a.startsWith("--"));
const data = JSON.parse(readFileSync(join(OUT, "aufgaben.json"), "utf8"));
const cachePfad = join(OUT, "cache.json");
const cache = existsSync(cachePfad) ? JSON.parse(readFileSync(cachePfad, "utf8")) : {};
const nutzung = { anfragen: 0, ausCache: 0, tokens: 0 };

async function api(input, questions) {
  const roh = JSON.stringify({ model: MODELL, input, questions });
  const hash = createHash("sha256").update(roh).digest("hex");
  if (cache[hash]) { nutzung.ausCache++; return cache[hash]; }
  let letzter = "";
  for (let v = 0; v < 5; v++) {
    try {
      const r = await fetch(API, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: roh });
      if (r.ok) {
        const res = await r.json();
        nutzung.anfragen++;
        nutzung.tokens += (res.usage && res.usage.total_input_tokens) || 0;
        cache[hash] = res;
        return res;
      }
      letzter = `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`;
      if (![429, 500, 502, 503, 504].includes(r.status)) throw new Error(letzter);
    } catch (e) {
      if (/^HTTP \d+/.test(e.message)) throw e;
      letzter = "Netzfehler: " + e.message;
    }
    await new Promise((r) => setTimeout(r, 2 ** v * 2000));
  }
  throw new Error(letzter);
}

const noul = (instructions, t, f) => (t ? { type: "noul", instructions, criteria: { true_description: t, false_description: f } } : { type: "noul", instructions });
const score = (instructions, levels) => ({ type: "score", instructions, criteria: levels });
// Questions where a high value is bad.
const SCHLECHT = new Set(["ratbar", "akzeptanz"]);

const TRACKS = { A: "Formeln umstellen", B: "Rechnen und Einheiten", C: "Diagramme lesen", D: "Fachsprache", E: "Synthese (mehrschrittige Aufgaben)", F: "Pfeile und Kräfte (Vektoren, Freikörperbild, Gleichgewicht, Zerlegung)" };
function rahmen(modul) {
  const m = modul.match(/^(Track|Gate)([A-F])(\d)(?:[A-F](\d))?/);
  let wo = "Einstufungstest des Bootcamps";
  if (m && m[1] === "Track") wo = `Track ${m[2]} (${TRACKS[m[2]]}), Level ${m[3]}`;
  if (m && m[1] === "Gate") wo = `Gate-Test von Level ${m[3]} nach Level ${m[4]} in Track ${m[2]} (${TRACKS[m[2]]}); bestanden ab 75 %`;
  return "Kontext: Fach Physik, Oberstufe Jahrgang 11 bis 13 einer Integrierten Gesamtschule in Niedersachsen. "
    + "Selbstlern-Bootcamp in Moodle (SCORM-Pakete), mastery-basiert: Level 1 Grundlagen, Level 2 Standard, Level 3 Vertiefung; "
    + "Gate-Tests schalten das nächste Level frei. Die Aufgaben werden automatisch geprüft. "
    + "Angaben in eckigen Klammern [Code: ...] zeigen die hinterlegte Prüfung (Antwortmuster mit | als ODER, Lösungswerte, "
    + "true/false für richtige oder falsche Option, Rückmeldetexte). Zahleneingaben werden meist tolerant geprüft (Komma oder Punkt). "
    + "Formeln stehen in LaTeX. Grafiken sind nur als Beschriftung angegeben. "
    + `Diese Aufgabe gehört zu: ${wo}.`;
}

function fragenAufgabe(it) {
  const t = it.text + " " + it.daten;
  const hatLoesung = !!(it.gateLoesung && Array.isArray(it.gateLoesung)) || /\[Code: |answers|correct|isCorrect|\bv: |d: \[|ok:|Hinterlegte richtige/.test(t);
  const mc = /\(Option |checkMC|mcSelect|selOpt|opt-pill/.test(t) || (t.match(/\[Code: /g) || []).length >= 3;
  const eingabe = /\[Eingabefeld\]/.test(it.text);
  const feedback = /wrong|err:|Falsch|fallback|diagnose|ok: '/.test(t);
  const Q = {
    fachlich: noul("Ist alles, was diese Aufgabe als richtig darstellt (Aufgabentext, Tipp, hinterlegte Lösung, als richtig markierte Option, Rückmeldetexte), physikalisch und mathematisch korrekt?",
      "fachlich korrekt, keine falsche Aussage und keine falsch hinterlegte Lösung", "enthält mindestens eine fachlich falsche Aussage oder eine falsch hinterlegte Lösung"),
    eindeutig: noul("Ist die Aufgabe eindeutig gestellt: klarer Auftrag, genau eine vertretbare Lösung, und es ist klar, in welcher Form (Einheit, Rundung, Schreibweise) geantwortet werden soll?",
      "eindeutig", "mehrdeutig: Auftrag unklar, mehrere vertretbare Lösungen oder unklare Antwortform"),
    verstaendlich: score("Wie verständlich sind Sprache und Arbeitsauftrag für SuS der Jahrgangsstufe 11, die selbstständig ohne Lehrkraft arbeiten?",
      ["schwer verständlich", "teilweise verständlich", "gut verständlich", "sehr gut verständlich"]),
  };
  if (hatLoesung) Q.loesung = noul("Ist die hinterlegte beziehungsweise als richtig markierte Lösung tatsächlich die richtige Antwort auf die gestellte Frage?",
    "ja, die hinterlegte Lösung beantwortet die Frage richtig", "nein, die hinterlegte Lösung ist falsch oder passt nicht zur Frage");
  if (feedback) Q.feedback = noul("Beschreiben die Rückmeldetexte zu falschen Antworten den jeweiligen Fehler zutreffend und fachlich richtig?",
    "ja, die Rückmeldungen passen zum jeweiligen Fehler", "nein, mindestens eine Rückmeldung ist falsch oder passt nicht zur Antwort");
  if (mc) Q.ratbar = noul("Kann man die richtige Option ohne Fachwissen erkennen, zum Beispiel weil sie deutlich länger, genauer oder als einzige fachsprachlich formuliert ist?",
    "ja, die richtige Option verrät sich durch ihre Form", "nein, die Optionen sind in Form und Länge ähnlich");
  if (eingabe && hatLoesung) Q.akzeptanz = noul("Würde eine fachlich richtige Antwort in einer üblichen anderen Schreibweise (gleichwertige Formel, sinnvoll gerundeter Wert, Wert mit Einheit) von den hinterlegten Antwortmustern vermutlich als falsch gewertet?",
    "ja, richtige Antworten in üblicher anderer Form würden abgelehnt", "nein, die hinterlegten Muster decken die üblichen Formen ab");
  return Q;
}

function fragenErklaerung() {
  return {
    fachlich: noul("Ist der Erklärtext physikalisch und mathematisch korrekt (Formeln, Definitionen, Beispiele, Zahlen)?",
      "fachlich korrekt", "enthält mindestens eine fachlich falsche Aussage"),
    verstaendlich: score("Wie verständlich ist der Erklärtext für SuS der Jahrgangsstufe 11, die ihn allein lesen?",
      ["schwer verständlich", "teilweise verständlich", "gut verständlich", "sehr gut verständlich"]),
  };
}

const wertVon = (a, q) => {
  if (!a) return null;
  if (q.type === "noul") return typeof a.noul === "number" ? a.noul : null;
  const n = q.criteria.length;
  return typeof a.score === "number" ? a.score / (n - 1) : null;
};
const stufe = (k, w) => (w === null ? "info" : SCHLECHT.has(k) ? (w > 0.6 ? "auffaellig" : w >= 0.4 ? "unsicher" : "ok") : (w < 0.4 ? "auffaellig" : w <= 0.6 ? "unsicher" : "ok"));

// Builds the list of checks: one per task, one per explanation text.
function jobsFor(modul, r) {
  const jobs = [];
  const seen = new Set();
  for (const it of r.items) {
    const loes = it.gateLoesung && Array.isArray(it.gateLoesung) ? `\nEntschlüsselte richtige Lösung des Gates: ${it.gateLoesung.join(" oder ")}` : "";
    const input = `${rahmen(modul)}\n\n=== Zu prüfende Aufgabe ===\n${it.text}${loes}${it.daten ? "\n\n=== Hinterlegte Daten im Code ===\n" + it.daten : ""}`;
    jobs.push({ modul, ort: `${modul} · ${it.id || "#" + it.nr}`, art: "Aufgabe", titel: it.text.split("\n").slice(0, 3).join(" ").slice(0, 160), input, fragen: fragenAufgabe(it) });
    if (it.erklaerung && it.erklaerung.length > 400 && !seen.has(it.erklaerung) && modul.startsWith("Track")) {
      seen.add(it.erklaerung);
      jobs.push({ modul, ort: `${modul} · Erklärung ${it.screen || ""}`, art: "Erklärung", titel: it.erklaerung.split("\n").slice(0, 4).join(" ").slice(0, 160),
        input: `${rahmen(modul)}\n\n=== Zu prüfender Erklärtext (Aufgaben entfernt) ===\n${it.erklaerung}`, fragen: fragenErklaerung() });
    }
  }
  return jobs;
}

// Built-in test errors: copies of real tasks with a deliberate flaw.
function mutanten(jobs) {
  const M = [];
  const add = (id, was, ort, frage, ersetzen) => {
    const j = jobs.find((x) => x.ort === ort);
    if (!j) { console.log(`Gegenprobe ${id}: ${ort} nicht gefunden`); return; }
    let inp = j.input;
    for (const [a, b] of ersetzen) { if (!inp.includes(a)) { console.log(`Gegenprobe ${id}: Text nicht gefunden`); return; } inp = inp.split(a).join(b); }
    M.push({ ...j, ort: `${j.ort} [Testfehler ${id}]`, input: inp, mutant: { id, was, frage, original: j.ort } });
  };
  add("T1", "Gate: falsche Option als Lösung", "GateA1A2 · qc2", "loesung", [["Entschlüsselte richtige Lösung des Gates: 2", "Entschlüsselte richtige Lösung des Gates: 0"]]);
  add("T2", "Formel-Muster falsch (a = F·m)", "TrackA1 · ex-0-3", "loesung", [["answers: 'f/m|F/m|f÷m|F÷m'", "answers: 'f*m|F*m|f·m|F·m'"], ["ok: 'Richtig! a = F/m'", "ok: 'Richtig! a = F·m'"]]);
  add("T3", "Richtig/falsch vertauscht", "TrackB3 · m0-ex5", "loesung", [["checkMCdetail(0,5,this,false,'Falsch. $k \\\\cdot x", "checkMCdetail(0,5,this,true,'Richtig. $k \\\\cdot x"], ["checkMCdetail(0,5,this,true,'Richtig! $F", "checkMCdetail(0,5,this,false,'Falsch! $F"]]);
  add("T4", "Hangabtriebskraft mit cos hinterlegt", "TrackF3 · m1-ex4", "fachlich", [["v: 200, wrong", "v: 346.41, wrong"], ["$F_H = 400\\\\,\\\\text{N} \\\\cdot \\\\sin 30^\\\\circ = 200\\\\,\\\\text{N}$", "$F_H = 400\\\\,\\\\text{N} \\\\cdot \\\\cos 30^\\\\circ = 346\\\\,\\\\text{N}$"]]);
  add("T5", "Gate: Umrechnung falsch hinterlegt", "GateB1B2 · qc3", "loesung", [["Entschlüsselte richtige Lösung des Gates: Zahl 10", "Entschlüsselte richtige Lösung des Gates: Zahl 129.6"]]);
  add("T6", "Rückmeldung passt nicht", "TrackF3 · m0-ex3", "feedback", [["m: 'Für $F_x$ hast du den Sinus genommen.", "m: 'Du hast die Einheit vergessen."]]);
  return M;
}

async function parallel(tasks, n = 6) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; await tasks[k](); } }));
}

const module = Object.keys(data).filter((m) => !nurModule.length || nurModule.includes(m));
let jobs = module.flatMap((m) => jobsFor(m, data[m]));
if (gegenprobe) jobs = jobs.concat(mutanten(jobs));
console.log(`${jobs.length} Prüfungen vorbereitet`);
const ergebnisse = [], fehler = [];
let done = 0;
await parallel(jobs.map((j) => async () => {
  try {
    const res = await api(j.input, j.fragen);
    const zeilen = Object.entries(j.fragen).map(([k, q]) => {
      const a = (res.answers || {})[k];
      const w = wertVon(a, q);
      return { key: k, frage: q.instructions, wert: w, konfidenz: a && a.confidence, stufe: stufe(k, w) };
    });
    ergebnisse.push({ modul: j.modul, ort: j.ort, art: j.art, titel: j.titel, zeilen, mutant: j.mutant || null });
  } catch (e) { fehler.push(`${j.ort}: ${e.message}`); }
  if (++done % 50 === 0) { console.log(`${done}/${jobs.length}`); writeFileSync(cachePfad, JSON.stringify(cache)); }
}));
writeFileSync(cachePfad, JSON.stringify(cache));
writeFileSync(join(OUT, "funde.json"), JSON.stringify({ datum: new Date().toISOString().slice(0, 10), nutzung, fehler, ergebnisse }, null, 1));
const auff = ergebnisse.filter((e) => !e.mutant).flatMap((e) => e.zeilen.filter((z) => z.stufe === "auffaellig").map((z) => ({ ...z, ort: e.ort })));
console.log(`${nutzung.anfragen} Anfragen (${nutzung.ausCache} aus Cache), ${nutzung.tokens} Tokens, ${fehler.length} Fehler, ${auff.length} auffällige Werte`);
if (fehler.length) console.log(fehler.slice(0, 5).join("\n"));
if (gegenprobe) for (const e of ergebnisse.filter((x) => x.mutant)) {
  const z = e.zeilen.find((x) => x.key === e.mutant.frage);
  const o = ergebnisse.find((x) => x.ort === e.mutant.original);
  const oz = o && o.zeilen.find((x) => x.key === e.mutant.frage);
  console.log(`  ${e.mutant.id} ${e.mutant.was.padEnd(38)} ${e.mutant.frage}: Testfehler ${z && z.wert !== null ? z.wert.toFixed(2) : "-"} / Original ${oz && oz.wert !== null ? oz.wert.toFixed(2) : "-"}`);
}
