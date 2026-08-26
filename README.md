# Physik Bootcamp - IGS Seevetal

SCORM-1.2-Lernpakete für das Physik Bootcamp (Jg. 11-13): Mastery-basiertes Selbstlernsystem mit 5 Tracks, je 3 Leveln und Gate-Tests zwischen den Leveln.

| Track | Thema | Level 1 | Level 2 | Level 3 |
|-------|-------|---------|---------|---------|
| A | Formeln umstellen | TrackA1 | TrackA2 | TrackA3 |
| B | Rechnen & Einheiten | TrackB1 | TrackB2 | TrackB3 |
| C | Diagramme | TrackC1 | TrackC2 | TrackC3 |
| D | Fachsprache | TrackD1 | TrackD2 | TrackD3 |
| E | Synthese | TrackE1 | TrackE2 | TrackE3 |

Dazu: **Gate-Tests** zwischen den Leveln (GateA1A2, GateA2A3, ...) und ein **Einstufungstest**.

## Repo-Struktur

```
src/<ModulId>/        Quellen (index.html + imsmanifest.xml) - hier wird gearbeitet
modules.json          Mapping ModulId -> ausgelieferte ZIP-Dateinamen
build.mjs             Baut packages/*.zip deterministisch aus src/
packages/*.zip        Generiert - NICHT von Hand bearbeiten
.github/workflows/    Baut die Pakete bei jedem Push auf src/ automatisch
```

**`src/` ist die einzige Wahrheit.** Die ZIPs in `packages/` werden vollständig daraus generiert. Änderungen direkt an den ZIPs gehen beim nächsten Build verloren.

## Workflow für Änderungen

1. HTML in `src/<ModulId>/index.html` bearbeiten
2. Committen und pushen. Die GitHub Action baut die ZIPs und committet sie automatisch
3. Moodle zieht die neuen Pakete beim nächsten Auto-Update (täglich)

Lokal bauen (optional, z. B. zum Testen): `node build.mjs` oder `node build.mjs TrackA2`

Der Build validiert jedes Modul (Manifest vorhanden und wohlgeformt, `index.html` vollständig, keine Steuerzeichen aus kaputten LaTeX-Escapes) und bricht bei Fehlern ab.

## Wichtig: ZIP-Dateinamen sind eingefroren

Moodle lädt die Pakete über feste `raw.githubusercontent.com`-URLs. Die Dateinamen in `packages/` (inkl. der historischen Versions-Suffixe wie `-v3.1`) dürfen sich deshalb **nie ändern**. Das Suffix sagt nichts mehr über den Inhalt aus; die tatsächliche Versionsgeschichte steckt in git. `TrackA1` wird unter zwei Dateinamen ausgeliefert (historisch bedingt), beide aus derselben Quelle.

## Moodle-Integration

Pakete werden als **Download-Pakettyp** eingebunden:

1. Admin: `allowtypelocalsync` aktivieren
2. Lernpaket anlegen, Pakettyp „Download" wählen
3. URL eintragen: `https://raw.githubusercontent.com/HerrOhlsen/Physik-Bootcamp-IGS-Seevetal/main/packages/DATEINAME.zip`
4. Auto-Update-Häufigkeit einstellen (aktuell: täglich)

Kurs: seevetal.moodle-nds.de, Kurs-ID 347.

## KI-Feedback

Drei Stellen holen KI-Rückmeldung: die drei Schreibaufgaben in **TrackD2** und der
**Gate-Test D2→D3**, der fünf Antworten mit 0 bis 4 Punkten bewertet.

Die Kette ist seit 26.08.2026: SCORM in Moodle → Edge Function `ki-feedback`
(Supabase, EU Frankfurt) → IONOS AI Model Hub (Berlin). Vorher lief das über einen
Make.com-Webhook; der ist raus, damit ein Auftragsverarbeiter weniger in der Kette
steht. Function, Datenmodell und Absicherung sind im Poolzeit-Repo beschrieben:
`docs/specs/2026-08-22-ki-feedback-design.md`.

**Systemprompt und Erwartungshorizont stehen nicht mehr im HTML**, sondern
serverseitig in der Tabelle `ki_prompts`. Der Client schickt nur `modul_id`,
`user_name` (`moodle_<id>` aus `M.cfg.userId`) und den Schülertext.

| modul_id | Stelle |
|---|---|
| `pb-trackd2-1` | TrackD2, KI-Aufgabe D2.1 (Energieerhaltung an der Rampe) |
| `pb-trackd2-2` | TrackD2, KI-Aufgabe D2.2 (Argumentation Bremsweg) |
| `pb-trackd2-3` | TrackD2, KI-Aufgabe D2.3 (Klausurantwort Fallschirmspringer) |
| `pb-gate-d2d3` | Gate-Test D2→D3, Punktbewertung als JSON |

Wer eine Aufgabe inhaltlich ändert, muss die passende Zeile in `ki_prompts`
mitziehen. Fehlt die Zeile, antwortet die Function mit 404 und die SuS lesen
„Für diese Aufgabe ist kein Feedback hinterlegt".

Das Modell steht in `ki_config` (aktuell Mistral Small 24B Instruct). Ein
Modellwechsel ist ein `UPDATE`, kein neuer Build: die SCORM-Pakete müssen dafür
nicht angefasst werden. Dasselbe gilt für den Notaus (`ki_config.aktiv = false`)
und die Tages- und Monatsbudgets.

## Rollback

Jeder Stand ist über git rückholbar:

```
git revert <commit>     # einzelne Änderung zurücknehmen
git push                # Moodle zieht den alten Stand beim nächsten Update
```
