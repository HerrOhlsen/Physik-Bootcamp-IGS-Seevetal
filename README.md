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

## Rollback

Jeder Stand ist über git rückholbar:

```
git revert <commit>     # einzelne Änderung zurücknehmen
git push                # Moodle zieht den alten Stand beim nächsten Update
```
