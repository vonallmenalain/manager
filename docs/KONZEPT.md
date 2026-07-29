# Manager – Konzept

Haushalts-Administration als PWA. Dokumente, Pendenzen, Einkaufsliste, Notizen und
Finanzen (Zehnten / Fastopfer) für zwei Personen.

Stand: 2026-07-28 · Status: Entwurf zur Freigabe

---

## 1. Ziel und Rahmen

**Problem:** Rechnungen, Post, Verträge und Belege liegen verteilt in Mail-Postfächern,
auf Papier und in Screenshots. Niemand weiss zuverlässig, was noch offen ist.

**Ziel:** Eine App, die auf dem Handy in unter 10 Sekunden ein Dokument aufnimmt,
es durchsuchbar ablegt, klar zeigt wer was wann erledigt hat – und daneben die
täglichen Kleinigkeiten (Einkauf, Notizen) sowie die Zehnten-Abrechnung abdeckt.

**Leitprinzipien:**

1. **Mobile first, Daumen first.** Jede Kernaktion in maximal zwei Taps erreichbar.
2. **Die Daten gehören uns.** Originaldateien liegen als normale Dateien auf dem QNAP,
   in einer lesbaren Ordnerstruktur – auch dann noch nutzbar, wenn die App eines Tages
   nicht mehr läuft.
3. **Der Container ist wegwerfbar.** Alles Wertvolle liegt in gemounteten Volumes,
   nicht im Container. Neu deployen darf nie Daten kosten.
4. **Nichts erzwingen.** OCR, Kategorien und Metadaten sind Vorschläge, keine Pflichtfelder.

**Nicht im ersten Wurf:** Mehrere Haushalte, Rollen/Rechte über "beide sehen alles"
hinaus, Buchhaltung im engeren Sinn, E-Mail-Postfach-Anbindung, Kalender.

---

## 2. Architektur im Überblick

```mermaid
flowchart TB
    subgraph Handy["📱 Handy / Desktop"]
        PWA["PWA – manager.alae.app<br/>installiert, offline-fähig"]
    end

    subgraph Netlify["☁️ Netlify"]
        CDN["Static Hosting<br/>React Build + Service Worker"]
    end

    subgraph CF["☁️ Cloudflare"]
        DNS["DNS alae.app"]
        TUN["Tunnel → manager-api.alae.app"]
    end

    subgraph QNAP["🏠 QNAP (Container Station)"]
        API["manager-api<br/>Fastify + OCR-Worker"]
        WT["Watchtower<br/>Auto-Update"]
        CFD["cloudflared"]
    end

    subgraph Vol["💾 QNAP Volumes (ausserhalb Container)"]
        DB[("SQLite<br/>/manager/data")]
        FILES["Originale + OCR<br/>/manager/storage"]
    end

    PWA -->|"HTML/JS"| CDN
    PWA -->|"API, Cookie-Auth"| TUN
    TUN --> CFD --> API
    API --- DB
    API --- FILES
    GH["GitHub<br/>push auf main"] -->|"Build → GHCR"| WT
    GH -->|"Auto-Deploy"| CDN
    WT -->|"pull + restart"| API
```

**Kurz:** Frontend statisch auf Netlify, Backend als Container zuhause auf dem QNAP,
verbunden über einen Cloudflare Tunnel. Daten liegen in zwei Bind-Mounts auf dem NAS.
Deployment passiert vollständig über `git push`.

---

## 3. Technologie-Entscheide

| Bereich | Wahl | Begründung |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Schnell, riesiges Ökosystem, gute PWA-Tooling-Lage |
| UI | Tailwind CSS + Radix Primitives | Mobile-first ohne Design-System-Ballast, barrierefreie Basiskomponenten |
| PWA | `vite-plugin-pwa` (Workbox) | Manifest, Service Worker, Precaching, Share Target aus einer Hand |
| State/Sync | TanStack Query + IndexedDB (Dexie) | Server-State-Caching und Offline-Queue ohne eigenes Framework |
| Backend | Node 22 + Fastify + TypeScript | Eine Sprache über den ganzen Stack, sehr schneller Upload-Pfad (Streams) |
| Datenbank | SQLite (better-sqlite3, WAL) + Drizzle ORM | Für zwei Nutzer ideal: eine Datei, kein Server, trivial zu sichern |
| Volltextsuche | Vereinheitlichte Spalte `search_text` + `LIKE` | FTS5 war geplant, wurde aber nicht gebraucht: Bei zwei Personen und einigen tausend Dokumenten ist `LIKE` schnell genug, und die Vereinheitlichung (Umlaute ausgeschrieben, Akzente entfernt) löst das Problem, an dem FTS5 hier gescheitert wäre – `LIKE` in SQLite kennt nur ASCII-Gross-/Kleinschreibung, `PRÄMIE` fände `Prämie` sonst nicht |
| OCR | Tesseract (deu, fra, eng) | Solides C++-Werkzeug ohne Abhängigkeitskette. OCRmyPDF wurde verworfen: Es zöge Python und Ghostscript nach und blähte das Image um mehrere hundert Megabyte auf – spürbar bei jedem Update über die Hausleitung. Sein Mehrwert wäre ein durchsuchbares PDF; den Text liefert Tesseract genauso, und er landet als .txt neben dem Original |
| PDF-Tools | Poppler (`pdftotext`, `pdftoppm`) | Digital erzeugte PDFs brauchen gar kein OCR |
| Jobs | Job-Tabelle in SQLite + In-Process-Worker | Kein Redis, keine zweite Infrastruktur für ~20 Jobs/Tag |
| Auth | Passwort (argon2id) + HttpOnly-Session-Cookie | Zwei Konten, kein Identity-Provider nötig |

**Warum SQLite und nicht Postgres:** Zwei Nutzer, wenige Schreibzugriffe gleichzeitig.
SQLite bedeutet: ein Container statt zwei, Backup = Dateikopie, kein Verbindungs-Pooling,
keine Passwörter. Wichtig ist nur, dass die DB-Datei auf einem *lokalen* QNAP-Volume liegt
(nicht auf einer NFS/SMB-Freigabe) – das ist mit Container-Station-Bind-Mounts gegeben.
Sollte die App je wachsen, ist der Wechsel dank ORM-Schicht ein überschaubarer Umbau.

---

## 4. Datenablage auf dem QNAP

Zwei getrennte Bind-Mounts, beide ausserhalb des Containers:

```
/share/Container/manager/data/          → DB_DIR   (SQLite + WAL, klein, schnell)
/share/Dokumente/Manager/               → STORAGE_DIR (Originale + Ableitungen, gross)
```

`STORAGE_DIR` darf bewusst auf einer anderen Freigabe oder einem anderen Volume liegen –
dort, wo dein bestehendes Backup (Hybrid Backup Sync / Snapshots) ohnehin schon greift.

**Ordnerstruktur der Ablage – bewusst menschenlesbar:**

```
/share/Dokumente/Manager/
├── 2026/
│   ├── Rechnungen/
│   │   ├── 2026-03-14__Krankenkasse-Praemie-Maerz__a3f9.pdf
│   │   └── 2026-03-14__Krankenkasse-Praemie-Maerz__a3f9.txt   ← OCR-Text
│   ├── Steuererklaerung/
│   └── Unsortiert/                      ← alles frisch Hochgeladene
├── 2025/
├── .previews/                           ← gerasterte PDF-Seiten, jederzeit neu erzeugbar
└── .trash/                              ← 30 Tage Papierkorb, dann echt gelöscht
```

* Dateiname = `Datum__Titel__kurz-ID`. Die 4-stellige ID am Ende macht ihn eindeutig,
  auch wenn zwei Dokumente gleich heissen.
* Die Datenbank kennt nur den **relativen Pfad**. Wird der Storage-Ordner verschoben,
  ändert sich nur eine Umgebungsvariable.
* Bei Änderung von Titel/Kategorie/Datum benennt die App die Datei atomar um und
  schreibt den neuen Pfad in die DB – die Ablage bleibt dauerhaft aufgeräumt.
* Ableitungen (OCR-Text, durchsuchbares PDF, Thumbnail) liegen neben dem Original.
* **Deduplizierung:** SHA-256 jeder Datei wird gespeichert. Beim Upload eines Duplikats
  fragt die App nach, statt still ein zweites Exemplar anzulegen.

---

## 5. Datenmodell

```mermaid
erDiagram
    USER ||--o{ DOCUMENT : "hochgeladen"
    USER ||--o{ DOCUMENT : "zugewiesen"
    CATEGORY ||--o{ DOCUMENT : ""
    DOCUMENT ||--o{ DOCUMENT_TAG : ""
    TAG ||--o{ DOCUMENT_TAG : ""
    DOCUMENT ||--o{ ACTIVITY : ""
    DOCUMENT ||--o{ JOB : "OCR"
    USER ||--o{ INCOME_ENTRY : ""
    FINANCE_YEAR ||--o{ INCOME_ENTRY : ""
    FINANCE_YEAR ||--o{ DONATION : ""
```

**Kerntabellen**

* `users` – id, name, email, password_hash, avatar_color, created_at
* `documents` – id, title, storage_path, mime, size_bytes, sha256, **uploaded_by**,
  **uploaded_at**, doc_date, category_id, **assigned_to**, **status**, due_date,
  amount_chf, vendor, ocr_status, ocr_text, notes, deleted_at
* `categories` – id, name, icon, sort_order (Steuererklärung, Kinder, Rechnungen,
  Wichtige Dokumente, Sonstiges). „Unsortiert" steht bewusst nicht darin: Das ist das
  Fehlen einer Zuordnung und damit der Zustand jedes frisch hochgeladenen Dokuments –
  als eigene Zeile gäbe es zwei Arten, dasselbe zu sagen. Die Liste im Code ist die
  Wahrheit und wird bei jedem Start abgeglichen (`syncCategories`); Dokumente einer
  entfernten Kategorie werden unsortiert und ihre Dateien wandern mit.
* `tags`, `document_tags` – freie Verschlagwortung neben den Kategorien
* `documents.search_text` – Titel, Absender, Notiz und OCR-Text in einer vereinheitlichten
  Spalte; dieselbe Aufbereitung nutzen auch `notes.search_text` und die Einkaufsliste
* `activity` – wer hat wann was gemacht (upload, status_change, assign, edit, delete).
  Erfüllt direkt die Anforderung "wer hat wann was hochgeladen" und gibt dem
  Dokument-Detail eine kleine Verlaufsspur.
* `jobs` – OCR-Warteschlange: id, document_id, type, state, attempts, error, timestamps
* `shopping_items` – Einkaufsliste; `shopping_memory` – die gelernte Zuordnung
  Artikel → Abteilung, bewusst getrennt, damit „Aufräumen" sie nicht mitlöscht
* `notes` – Notizen mit Art (Text oder Checkliste), Sichtbarkeit (`shared`), Farbe,
  Anheftung und eigener Suchspalte
* `finance_years` – Steuerbetrag je Jahr. Mehr wird zu einem Jahr nicht eingestellt
* `income_entries` – Einnahmen je Person und Monat, plus benannte Zusatzeinnahmen
* `donations` – Zehnten, Fastopfer und weitere Spenden mit Datum, den abgerechneten
  Monaten (`covers_months`, z. B. `3,4,5`) und – beim Zehnten – dem damit verrechneten
  Steuerguthaben
* `sessions` – angemeldete Geräte

**Dokument-Status:** `offen` → `in_arbeit` → `erledigt` → `archiviert`.
Bewusst nur vier, mit `offen` als Default. Alles was nicht `erledigt`/`archiviert` ist,
erscheint auf dem Dashboard unter "Pendent".

---

## 6. Funktionen im Detail

### 6.0 Startbildschirm und Konto

**Der Startbildschirm ist eine Übersicht, kein Arbeitsplatz.** Jede Kachel beantwortet eine
Frage in zwei, drei Zeilen und führt beim Antippen dorthin, wo man damit weiterarbeitet –
die ganze Kachel, nicht ein „Alle ansehen" in der Ecke. Technisch ist der Titel der
Verweis und legt sich mit `::after` über die Kachel: ein echter Link mit Ziel in der
Statusleiste, kein `onClick` auf einem Kasten. Zeilen mit eigenem Ziel – eine angeheftete
Notiz – heben sich mit `z-10` darüber und behalten ihres.

Vier Kacheln stehen zur Wahl: **Pendente Dokumente** (die nächsten vier, Fristen zuerst),
**Zehnter** (offener Betrag und die Monate dazu), **Einkaufsliste** (was noch fehlt) und
**Angeheftete Notizen** (nur die Titel, jeder öffnet seine Notiz über `?notiz=<id>`).
Welche erscheinen und in welcher Reihenfolge, stellt der Stift beim Gruss ein – Häkchen
und zwei Pfeile, gespeichert im `localStorage` am Gerät. Was den einen morgens
interessiert, ist für den anderen Rauschen; und keine Kachel zeigt mehr als vier Zeilen,
sonst wäre es keine Übersicht.

**Das Konto steckt hinter dem Kreis** mit dem Anfangsbuchstaben, oben links: die eigene
Adresse und das Abmelden. Vorher stand daneben „Angemeldet" – eine Zeile, die nichts sagt,
was man nicht schon sieht – und ein Knopf zum Abmelden, den man täglich sah und selten
brauchte.

**Verwalter des Haushalts** ist genau ein Konto (`ADMIN_EMAIL` im geteilten Paket). Es
gibt keine Rollentabelle: Es gibt einen, der die App betreibt, und er ändert sich nicht.
Verwalter heisst nicht „sieht mehr" – Dokumente, Notizen und Finanzen gehören dem Haushalt
gemeinsam. Es heisst: darf **Mitglieder anlegen** und sieht im Kontomenü, **ob der Server
erreichbar ist** (ohne Versionsnummer – die beantwortet keine Frage, die man sich am Handy
stellt). Beides steckt im Kontomenü und nicht mehr als Kachel auf dem Startbildschirm:
Das ist Betrieb, nicht Haushalt.

Die Prüfung steht im Server (`requireAdmin`), nicht nur in der Oberfläche. Ein
ausgeblendeter Knopf ist keine Sperre – die Adresse der Route steht in jedem
Netzwerk-Reiter. Das Frontend liest `isAdmin` aus dem Nutzerprofil, das der Server aus der
Adresse ableitet; so kennt die Regel nur eine Stelle.

### 6.1 Dokumente

**Erfassen – fünf Wege, alle schnell:**

| Weg | Plattform | Beschreibung |
|---|---|---|
| Teilen-Menü | Android | PDF aus Gmail/Outlook → Teilen → "Manager". Web Share Target. |
| Kurzbefehl | iOS | Teilen → Kurzbefehl "An Manager", lädt direkt via API hoch (siehe 8.2) |
| Dokument scannen | beide | In-App: Foto → automatischer Randbeschnitt, Entzerrung, Kontrast → PDF |
| Foto aufnehmen | beide | Kamera-App des Systems, mit allen Modi die sie mitbringt |
| Datei/Screenshot | beide | Normaler Datei-Picker, Mehrfachauswahl möglich |

Nach dem Upload landet das Dokument sofort in der Liste – der Nutzer wartet **nie** auf OCR.
Die Verarbeitung läuft im Hintergrund, der Status wird live nachgeführt.

**Der Dokumentenmodus** (`apps/web/src/lib/scan/`) ist der Unterschied zwischen Foto und
Scan. Der Auslöser holt über `ImageCapture.takePhoto()` ein Standbild in der vollen
Auflösung des Sensors – der Videostrom der Live-Vorschau hätte selten mehr als 1920
Zeilen, und davon bliebe bei einer A4-Seite, die zwei Drittel des Suchers füllt, keine
150 dpi für die Texterkennung. Kann ein Gerät das nicht, wird das Bild aus dem Live-Strom
genommen und in dieser Sitzung nicht mehr nachgefragt. Darin wird die Seite gesucht
(Otsu-Schwelle, zusammenhängende Fläche um die Bildmitte, konvexe Hülle auf vier Ecken
zurückgeführt), zur Kontrolle angezeigt und von Hand nachziehbar. Danach wird perspektivisch entzerrt und – der Schritt,
der am meisten ausmacht – der Helligkeitsverlauf herausgerechnet: Jeder Bildpunkt wird
durch die geschätzte Papierhelligkeit an seiner Stelle geteilt, womit der Schatten des
eigenen Kopfes verschwindet. Zur Wahl stehen Farbe, Graustufen und Schwarz-Weiss.
Gerechnet wird ohne Bildverarbeitungs-Bibliothek; OpenCV.js wöge ein Vielfaches der
ganzen App.

**Mehrere Seiten** landen zuerst in einem Stapel statt sofort in der Ablage. Jede
übernommene Seite führt dorthin zurück; von dort geht es über „Weitere Seite" mit einer
frisch geöffneten Kamera weiter, und Seiten lassen sich umsortieren und entfernen. Erst "Ablegen" schreibt sie in ein Dokument – ab zwei Seiten als PDF (die
JPEGs wandern unverändert hinein, `DCTDecode`), bei einer einzelnen bleibt es beim Bild.
Für die Texterkennung ändert sich dadurch nichts: Ein PDF ohne Textebene rastert der
Server ohnehin und schickt es durch Tesseract.

Die Kamera-App des Systems ist der zweite Weg, absichtlich ohne `capture`-Attribut: Mit
ihm öffnet Android sofort die nackte Aufnahme-Ansicht, ohne es die Auswahl, über die sich
die Kamera-App samt ihrem eigenen Dokumentenmodus öffnen lässt. Auch diese Fotos gehen in
den Stapel, werden dort aber nicht nachbearbeitet – nur gedreht (EXIF) und verkleinert.

**Erfassungs-Dialog** (erscheint direkt nach dem Upload, alles vorausgefüllt und optional):
Titel · Kategorie · Datum · Zuständig (ich / Ehefrau / beide) · Status · Fällig am · Betrag.
Ein Tap auf "Fertig" genügt, alles andere lässt sich später ergänzen.

**Suchen:** Ein Suchfeld über allem. Sucht gleichzeitig in Titel, Absender, Notizen und
OCR-Volltext, mit Treffer-Hervorhebung im Textausschnitt. Dazu Filterchips für Kategorie,
Person, Status, Jahr und Betragsbereich.

**Ansichten:** Startbildschirm (Kachel „Pendent" mit den nächsten Fristen) · Liste/Suche ·
Dokument-Detail (Vorschau, Metadaten, Verlauf, Teilen, Download).

### 6.2 Einkaufsliste

Eine gemeinsame Liste. Neuer Eintrag über ein einzeiliges Feld am unteren Rand (immer
erreichbar, der Fokus bleibt nach dem Absenden darin – man trägt selten nur eine Sache
ein). Die ganze Zeile ist die Trefferfläche zum Abhaken; im Laden trifft man kein kleines
Kästchen. Erledigtes rutscht in einen eigenen Block, „Aufräumen" leert ihn.

**Nach Abteilungen sortiert**, in der Reihenfolge des Ladenrundgangs (Früchte & Gemüse →
… → Haushalt). Ein neuer Eintrag bekommt seine Abteilung aus einer schlichten
Stichwortliste (`Vollmilch` → Molkerei, `Ruchbrot` → Brot & Backwaren). Liegt sie falsch,
korrigiert man sie einmal – **die Korrektur wird dauerhaft gemerkt** und gilt beim
nächsten Mal von selbst.

Das Gelernte steht bewusst in einer eigenen Tabelle (`shopping_memory`), nicht am Eintrag:
„Aufräumen" läuft nach jedem Einkauf und würde das Gelernte sonst jedes Mal mitlöschen.

Jede Änderung erscheint sofort in der Liste und wird erst danach zum Server geschickt
(bei einem Fehler zurückgerollt). Im Laden zählt das mehr als anderswo – mit einem Balken
Empfang fühlt sich eine halbe Sekunde Verzögerung an, als hätte die App den Tipp
verschluckt. Änderungen der anderen Person kommen alle 20 Sekunden nach.

### 6.3 Notizen

Kurze Notizen mit Titel und Inhalt, in zwei Arten: **Fliesstext** oder **Checkliste** mit
Einträgen zum Abhaken. Die Art wird beim Anlegen gewählt (zwei Einträge am Plus-Knopf)
und bleibt dann, was sie ist – ein Umschalten hinterher wäre eine Umwandlung mit
Verlusten für einen Fall, den es im Alltag kaum gibt. Dazu Anheften (steht dann
zuoberst), fünf gedeckte Farben und Suche über Titel und Inhalt – mit denselben Regeln
wie bei den Dokumenten, also findet `zuegeltermin` auch „Zügeltermin". Bewusst schlicht –
kein zweites Notion.

**Abgehaktes rutscht nach unten.** Eine Liste beantwortet die Frage „was ist noch zu
tun", und die steht dann oben statt zwischen Durchgestrichenem. Sortiert wird der
gespeicherte Inhalt selbst, nicht nur die Anzeige – so sieht die Liste auf jedem Gerät
gleich aus und die Vorschau in der Übersicht zeigt dieselben offenen Punkte.

**Nur für mich oder geteilt.** Jede Notiz gehört zunächst dem, der sie anlegt, und wird
über einen Schalter im Fenster bewusst freigegeben. Umgekehrt herum wäre es die falsche
Voreinstellung: Ein Freigeben lässt sich zurücknehmen, ein Gelesenwerden nicht. Geteilte
Notizen sind für beide da – wer sie sieht, darf sie auch ändern und löschen, wie bei den
Dokumenten. Die Prüfung steht serverseitig in jeder Abfrage, auch beim Ändern und
Löschen; sonst wäre eine fremde Notiz über ihre Kennung erreichbar, ohne je in einer
Liste aufgetaucht zu sein.

**Die Übersicht lässt sich einstellen.** Wo früher die Anzahl stand – eine Zahl, die man
abzählen kann und die nichts entscheidet –, stehen zwei kleine Auswahlfelder:

* **Ansicht:** Liste (eine Notiz je Zeile) oder Kacheln (zwei Spalten, jede so hoch wie
  ihr Inhalt). Zwei Spalten auch am grossen Bildschirm: Die Seite ist überall gleich
  breit, und drei liessen von jeder Zeile nur noch ein paar Wörter übrig.
* **Anzeigegrösse:** `Klein` gibt jeder Notiz dieselbe feste Höhe – Titel und zwei Zeilen,
  die Übersicht bleibt ein Verzeichnis. `Alles` schneidet nichts ab, für den, der seine
  Notizen lesen und nicht suchen will. `Komprimiert` richtet sich nach dem Inhalt: Wer
  mehr geschrieben hat, bekommt mehr Platz, aber höchstens sechs Zeilen. Ohne diese Grenze
  verdrängt eine einzige lange Notiz alle anderen vom Bildschirm – und genau das soll eine
  Übersicht nicht.

Beides hängt im `localStorage` am Gerät und nicht am Konto: Wie eine Liste angezeigt wird,
ist eine Angabe über den Bildschirm, auf den man gerade schaut – am Handy will man anderes
sehen als am Monitor.

Rechts oben in jeder Notiz steht, **wann zuletzt geschrieben wurde**, mit Datum und
Uhrzeit. Damit die Angabe stimmt, speichert das Autospeichern nur, was vom Stand beim
Öffnen abweicht: Wer eine Notiz nur anschaut – oder eine Änderung wieder zurücknimmt –,
hat nichts geändert, und es soll auch nichts dastehen.

Eine Notiz öffnet als **Fenster über der Liste**, nicht als eigener Bildschirm: Sie ist
eine Randnotiz, kein Formular. Das Fenster ist so hoch wie sein Inhalt und wächst mit ihm
bis kurz vor den Bildschirmrand – auch das Textfeld wächst beim Tippen mit, statt in sich
selbst zu scrollen, während das Fenster darüber noch Platz hätte. Man soll nicht durch ein
Guckloch schreiben. Der schmale Rand bleibt: Er zeigt, dass darunter die Seite liegt.

Gespeichert wird **von selbst** – kurz nach dem letzten Tastendruck und noch einmal beim
Schliessen. Einen Speichern-Knopf gibt es nicht; er war die einzige Möglichkeit,
Geschriebenes zu verlieren. Eine neue Notiz entsteht erst beim ersten Speichern, wer das
Fenster leer wieder schliesst, hinterlässt keine.

Die **Farbe** steckt in einem kleinen Aufklappfeld neben „Nur für mich" – vorher standen
alle fünf ständig im Fuss des Fensters. Das ist viel Aufmerksamkeit für eine Entscheidung,
die man einmal trifft und dann jahrelang nicht mehr anfasst; den Platz hat die Notiz
selbst nötiger.

Beide Arten liegen im selben Feld `body`: Eine Checkliste schreibt je Zeile einen Eintrag
mit vorangestelltem `[ ]` oder `[x]`. Eine eigene Tabelle für Listeneinträge wäre die
lehrbuchmässige Lösung und hier reiner Ballast – es gibt kein Sortieren über Notizen
hinweg und keine Rechte je Eintrag, und eine Notiz wird immer als Ganzes gespeichert.
Dafür bleibt sie in der Datenbank lesbar und die Volltextsuche findet sie ohne
Zusatzarbeit (ohne die Kästchen, gesucht wird nach „Milch", nicht nach „[x] Milch").

### 6.4 Finanzen: Zehnten und Fastopfer

Das Herzstück neben den Dokumenten.

**Erfassung pro Monat** – ein Fenster über der Liste, zwei Zahlen:

```
September 2026                            Gespeichert
  Einkommen Alain        CHF  6'200.00
  Einkommen [Ehefrau]    CHF  3'800.00
  + weitere Einnahme

  Einkommen                 10'000.00
  Zehnter (10 %)             1'000.00
```

Gespeichert wird von selbst – hier wie bei den Notizen, aus demselben Grund. Nur das
Erfassen einer Zahlung hat einen Knopf: Eine Zahlung ist ein Ereignis und kein Text, an
dem man arbeitet; beim Tippen gespeichert entstünde für jeden Zwischenstand ein Beleg.

Die Beträge werden so gelesen, wie man sie in der Schweiz schreibt: `8'450.00`, `8’450`
mit typografischem Apostroph, `8450,50` mit Komma. Gespeichert wird in Rappen, damit
keine Gleitkommazahl je einen Rappen verliert.

**Steuern:** Zum Jahr wird genau eine Zahl hinterlegt – der Steuerbetrag. Der Satz steht
nicht mehr zur Wahl (ein Zehntel ist ein Zehntel), und einen Abrechnungsstand von Hand
gibt es auch nicht mehr; er folgt den Zahlungen.

Das Konzept sah ursprünglich drei Berechnungsbasen vor (`brutto`, `brutto_minus_steuern`,
`netto`). Alle drei laufen auf dasselbe hinaus: Ob man das Bruttoeinkommen ohne Abzug
oder das ausbezahlte Netto einträgt, ist dieselbe Rechnung mit einer anderen Zahl im
Feld.

**Von den Steuern ist ein Zehntel verrechenbar, nicht die ganze Summe.**

Steuern mindern nicht die Zahlung, sondern das Einkommen, auf das der Zehnte gerechnet
wird. Wer CHF 15 000 Steuern hinterlegt, zahlt darum über das Jahr CHF 1 500 weniger
Zehnten – nicht CHF 15 000. Genau dieses Guthaben führt die App: `taxCreditFor()` macht
aus dem Steuerbetrag den verrechenbaren Betrag, und in der Zahlung steht, wie viel davon
gerade verrechnet wird.

Ursprünglich verteilte die App den Jahressteuerbetrag gleichmässig auf zwölf Monate und
rechnete kumulativ, damit die Monatswerte am Jahresende genau aufgingen. Das war
rechnerisch sauber und im Alltag falsch herum: Wer im März zahlt, weiss selbst am besten,
wie viel Steuern bis dahin angefallen sind – ein Zwölftel je Monat ist bloss eine
Annahme. Und ein erfasster Monat ohne Lohn bekam einen negativen Zehnten, den am
Bildschirm niemand erklären konnte.

Verrechnet wird deshalb bei der Zahlung – ganz oder in Teilen. Die Jahresrechnung ist
dadurch eine schlichte Jahresrechnung:

```
Einkommen (alle erfassten Monate)   CHF 16 000.00
-> Zehnter (10 %)                    CHF  1 600.00
- Steuern verrechnet                 CHF    400.00
- bereits bezahlt                    CHF    400.00
= offen                              CHF    800.00
```

Der Monatswert in der Liste ist damit schlicht ein Zehntel des Monatseinkommens. Was das
Steuerguthaben davon abzieht, steht in der Kachel zuoberst, zusammen mit dem Stand: wie
viel verrechenbar ist, wie viel schon verrechnet wurde und wie viel noch offen.

**Abrechnungsstand:** In `donations` werden geleistete Zahlungen erfasst (Datum, Betrag,
Art: Zehnten / Fastopfer / andere Spende, dazu die abgerechneten Monate und – beim
Zehnten – das verrechnete Steuerguthaben). Abgerechnet ist, was eine Zahlung abgehakt
hat. Eine gelöschte Zahlung gibt ihre Monate wieder frei, und es gibt keine zweite
Stelle, an der von Hand nachzuführen wäre.

Das Dashboard zeigt daraus dauerhaft:

> **Zehnter 2026 · CHF 2 050.00** offen für Juni–August
> *Abgerechnet: Januar–Mai.*

**Eine Zahlung, ein Vorgang:** Man hakt die offenen Monate ab – alles andere rechnet sich
daraus. Der Zehnte steht nicht zur Eingabe: Er ist ein Zehntel des erfassten Einkommens
dieser Monate, und ein Feld dafür wäre bloss eine Gelegenheit, sich zu vertippen. Zur
Eingabe stehen die Monate, das Fastopfer je Monat, das verrechnete Steuerguthaben und
der Zahltag; unten in der Kachel steht, was zu überweisen ist, und woraus es besteht:

```
Monate abrechnen        [x] Januar   5 000.00   500.00
                        [x] Februar  5 000.00   500.00
                        [x] März     5 000.00   500.00
                        [x] April    5 000.00   500.00
Fastopfer pro Monat     CHF     50.00
Steuern verrechnen      CHF  1 500.00
Bezahlt am              01.05.2026

  Zu bezahlen                        CHF  700.00
  Zehnter (4 Monate)                    2 000.00
  - Steuern verrechnet                  1 500.00
  Fastopfer (4 Monate × 50.00)            200.00
```

Gespeichert werden zwei Zeilen, weil die Kirche Zehnten und Fastopfer getrennt ausweist.
Die Zeile für den Zehnten entsteht immer – auch über 0. Sie ist es, die die Monate
abrechnet, und ein Monat ohne Lohn will genauso abgehakt werden wie einer mit.

Was sich nicht verrechnen lässt, wird gedeckelt statt abgewiesen: höchstens das
verbleibende Guthaben und höchstens der Zehnte dieser Zahlung. Der Rest bleibt stehen
und wartet auf die nächste – ein Beleg über einen negativen Betrag wäre keine Zahlung.
Gerechnet wird mit derselben Funktion (`computePayment`) in der Vorschau und auf dem
Server; am Bildschirm kann so keine andere Zahl stehen als gleich danach in der Liste.

**Fastopfer** läuft rechnerisch getrennt – es verändert den Zehnten nicht. Eingegeben
wird der Betrag je Monat, weil man ihn so festlegt; die Zahlung nimmt ihn mal Anzahl
abgehakter Monate.

**Jahresübersicht:** Zuoberst die Kachel mit dem Stand – offener Zehnter, Einkommen,
verrechnete Steuern, bezahlt. Darunter die Monatsliste und die Zahlungen. Export als CSV, mit Semikolon und einem
BOM voran, damit Excel die Datei ohne Import-Dialog und mit richtigen Umlauten öffnet.
Die Zahlungen stehen in derselben Datei – fürs Jahresgespräch soll man nicht zwei Sachen
zusammensuchen müssen. **Kein PDF-Export:** Das Handy druckt jede Ansicht über
„Teilen → Drucken → Als PDF sichern"; eine eigene PDF-Erzeugung im Container wäre
Aufwand für etwas, das das Betriebssystem schon kann.

---

## 7. OCR-Pipeline

```mermaid
flowchart LR
    A["Upload"] --> B{"PDF mit<br/>Textebene?"}
    B -->|ja| C["pdftotext<br/>≈0.2 s"]
    B -->|nein| D["pdftoppm + Tesseract<br/>deu+fra+eng"]
    D --> E[".txt neben dem Original"]
    C --> F["search_text<br/>vereinheitlicht"]
    E --> F
    F --> G["Suche über Titel,<br/>Absender, Notiz, Inhalt"]
```

* **Schritt 1 – gratis abkürzen:** Digital erzeugte PDFs (die Mehrheit aus E-Mails) haben
  bereits eine Textebene. `pdftotext` liefert sie in Millisekunden, ohne OCR.
* **Schritt 2 – OCR nur wenn nötig:** Fotos und gescannte PDFs werden mit `pdftoppm`
  in Bilder zerlegt und von Tesseract gelesen. Das Original bleibt unangetastet,
  daneben entsteht eine `.txt`-Datei. Rechenzeit auf dem QNAP: grob 3–10 s pro Seite.
* **Schritt 3 – Metadaten:** Noch offen. Vorgesehen ist zuerst Regex/Heuristik auf
  Schweizer Muster (Beträge `1'234.55`, Datumsformate, IBAN, "zahlbar bis"), optional
  zuschaltbar die Claude API für strukturierte Extraktion. Das bleibt eine austauschbare
  Komponente – die App funktioniert vollständig ohne.
* **Später (Etappe 6): Schweizer QR-Rechnung.** Der QR-Code auf praktisch jeder Rechnung
  enthält Betrag, Empfänger und Referenz strukturiert und fehlerfrei. Auslesen ist
  deutlich verlässlicher als jedes OCR – für unseren Alltag der grösste Einzelgewinn.

Fehlgeschlagene Jobs werden dreimal mit wachsendem Abstand wiederholt und danach im
Dokument sichtbar markiert ("Texterkennung fehlgeschlagen – erneut versuchen").

---

## 8. PWA und Mobile

### 8.1 Installation und Verhalten

Manifest mit `display: standalone`, Icons bis 512 px, Maskable-Icon, Theme-Color,
`orientation: portrait`. Auf Android über den Installations-Prompt, auf iOS über
"Zum Home-Bildschirm". Ab iOS 26 öffnen Home-Screen-Sites standardmässig als Web-App.

**Offline:** App-Shell und zuletzt geladene Listen werden vorgehalten, ein Hinweisband
zeigt an, dass keine Verbindung besteht – man sieht also weiterhin, was auf der
Einkaufsliste steht und was in den Notizen. Änderungen ohne Netz sind noch nicht
möglich: Sie erscheinen kurz und werden zurückgerollt, sobald der Server nicht antwortet.

Eine echte Warteschlange (lokale Änderungen zwischenspeichern und bei Verbindung
nachschicken) ist bewusst auf **Etappe 6** verschoben. Sie bringt Konfliktfälle mit sich
– zwei Personen ändern dieselbe Zeile, beide offline –, die eine eigene Runde verdienen,
statt nebenbei mitgebaut zu werden.

### 8.2 Das Teilen-Thema – ehrlich betrachtet

Dies ist der einzige Punkt, an dem die Plattformen auseinanderlaufen:

* **Android:** Web Share Target funktioniert. `share_target` im Manifest mit
  `method: POST`, `enctype: multipart/form-data`. Der Service Worker fängt den Request ab,
  legt die Datei in der Cache Storage ab und leitet in die Erfassungsmaske um. Damit ist
  "PDF aus Mail → Teilen → Manager" genau so schnell wie gewünscht.
* **iOS/iPadOS:** Safari unterstützt Web Share Target **nicht** – auch 2026 nicht.
  Eine installierte PWA erscheint dort nicht im Teilen-Menü. Das lässt sich nicht
  umgehen, aber gleichwertig lösen:
  **Apple-Kurzbefehl "An Manager"**. Ein Kurzbefehl, der Dateien entgegennimmt und per
  `POST` an `manager-api.alae.app/api/share` sendet (mit einem langlebigen Gerätetoken aus der App).
  Er erscheint direkt im iOS-Teilen-Menü, exakt neben den nativen Apps. Ich liefere den
  Kurzbefehl fertig konfiguriert mit – Einrichtung einmalig, etwa zwei Minuten.

**Deshalb ist die Frage nach eurer Handy-Plattform die wichtigste offene Entscheidung** –
sie bestimmt, welcher der beiden Wege in Etappe 2 gebaut wird (oder beide).

---

## 9. Sicherheit und Zugang

* **Konten:** Zwei, manuell angelegt, keine offene Registrierung. Anlegen darf nur der
  Verwalter des Haushalts (`ADMIN_EMAIL`), geprüft im Server über `requireAdmin` – ein neues
  Konto ist der eine Vorgang, der Zugang schafft.
* **Passwörter:** argon2id. Session als HttpOnly-, Secure-, SameSite=Lax-Cookie auf
  `.alae.app`. Da `manager.alae.app` und `manager-api.alae.app` dieselbe Registrable Domain
  teilen, gilt das als same-site – kein `SameSite=None` nötig, keine Third-Party-Cookie-Probleme.
* **Sitzungsdauer:** 90 Tage mit rollierender Erneuerung. Auf dem Handy soll man sich
  nicht ständig neu anmelden. Optional später: Face-ID/Touch-ID via Passkey (WebAuthn).
* **CORS:** Strikt auf `https://manager.alae.app` beschränkt, `credentials: true`.
* **Rate Limiting** auf Login und Upload-Endpunkten.
* **Keine Ports offen.** Der Cloudflare Tunnel baut die Verbindung von innen nach aussen
  auf; die QNAP-Firewall braucht keine eingehende Regel. Zusätzlich: Cloudflare WAF-Regel,
  die alles ausser den erwarteten API-Pfaden verwirft.
* **Dateizugriff:** Dokumente werden nie direkt vom Webserver ausgeliefert, sondern nur
  über authentifizierte Endpunkte mit kurzlebigen, signierten Download-Links.
* **Backup:** Nächtlich `sqlite3 .backup` in den Storage-Ordner, damit dein bestehendes
  QNAP-Backup eine garantiert konsistente Kopie mitnimmt. Zusätzlich 30-Tage-Papierkorb
  statt echtem Löschen.

---

## 10. Deployment – "Claude Code aktualisiert den Container"

```mermaid
flowchart LR
    CC["Claude Code<br/>commit + push"] --> GH["GitHub main"]
    GH --> GA["GitHub Actions<br/>Build + Test"]
    GA --> GHCR["ghcr.io/…/manager-api<br/>:latest + :sha"]
    GA --> NL["Netlify Deploy<br/>manager.alae.app"]
    GHCR -.->|"Polling alle 5 min"| WT["Watchtower<br/>auf QNAP"]
    WT --> API["Container neu gestartet<br/>Migrationen laufen automatisch"]
```

**Backend:** Push auf `main` → GitHub Actions baut ein Multi-Arch-Image (amd64 + arm64)
und pusht es nach GHCR. Watchtower auf dem QNAP prüft alle fünf Minuten, zieht die neue
Version und startet den Container neu – nur Container mit passendem Label, damit deine
anderen Dienste unberührt bleiben. Datenbank-Migrationen laufen beim Start automatisch.
Kein eingehender Zugriff auf das NAS nötig, kein manueller Schritt.

**Frontend:** Netlify baut bei jedem Push automatisch und veröffentlicht auf
`manager.alae.app`.

**Ergebnis:** Ich sage "das ist umgesetzt", und fünf Minuten später läuft es bei dir –
ohne dass du dich am QNAP anmelden musst.

**docker-compose.yml auf dem QNAP** (einmalig einrichten, danach unverändert):

```yaml
services:
  manager-api:
    image: ghcr.io/vonallmenalain/manager-api:latest
    container_name: manager-api
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DB_DIR=/data
      - STORAGE_DIR=/storage
      - APP_ORIGIN=https://manager.alae.app
      - SESSION_SECRET=${SESSION_SECRET}
      - OCR_LANGUAGES=deu+fra+eng
    volumes:
      - /share/Container/manager/data:/data
      - /share/Dokumente/Manager:/storage
    labels:
      - com.centurylinklabs.watchtower.enable=true

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}

  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    command: --interval 300 --label-enable --cleanup
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Falls dein Auto-Update bei der Share-App anders funktioniert (Portainer-Webhook,
eigenes Skript, …), übernehmen wir stattdessen genau dieses Muster – bewährt schlägt neu.

---

## 11. Projektstruktur

```
manager/
├── apps/
│   ├── web/          React-PWA  → Netlify
│   └── api/          Fastify + OCR-Worker → Container
├── packages/
│   └── shared/       Typen, Zod-Schemas, Berechnungslogik (von beiden genutzt)
├── infra/
│   ├── docker-compose.yml
│   └── Dockerfile
├── docs/
│   ├── KONZEPT.md
│   └── SETUP-QNAP.md
└── .github/workflows/
```

Ein Monorepo mit npm-Workspaces. Der entscheidende Gewinn: `packages/shared` enthält die
API-Verträge und die Zehnten-Berechnung genau einmal – Frontend und Backend können nicht
auseinanderlaufen, und die Rechenlogik ist an einem Ort testbar.

---

## 12. Roadmap

Jede Etappe ist eigenständig deploybar und sofort nutzbar. Nach Etappe 1 hast du bereits
eine funktionierende App auf dem Handy.

| # | Etappe | Inhalt | Ergebnis für dich |
|---|---|---|---|
| **0** ✅ | **Fundament** | Monorepo, CI/CD, Container, Tunnel, Domain, Login | `manager.alae.app` ist erreichbar, ihr könnt euch anmelden |
| **1** ✅ | **Dokumente** | Upload, Liste, Detail, Kategorien, Status, Zuweisung, Metadatensuche, Aktivitätsverlauf | Erste echte Dokumente sind abgelegt und auffindbar |
| **2** ✅ | **Mobil** | PWA-Installation, Share Target (Android), Dokumentenmodus mit Randerkennung, mehrseitige Scans, Offline-Hülle | Der 10-Sekunden-Weg vom Mail zum abgelegten Dokument |
| **3** ✅ | **OCR** | Worker, Textebene + Tesseract, Volltextsuche, Textausschnitte | Suche findet Inhalte, nicht nur Titel |
| **4** ✅ | **Alltag** | Einkaufsliste nach Ladenabteilungen (lernt aus Korrekturen), Notizen und Checklisten mit Autospeichern, privat oder geteilt, Anheften, Farben und Suche | Die App wird täglich benutzt, nicht nur bei Post |
| **5** ✅ | **Finanzen** | Monatserfassung, Steuerabzug, Zehnten-Berechnung, Abrechnungsstand, Fastopfer, CSV-Export | Die Zehnten-Abrechnung ist erledigt statt geschätzt |
| **6** | **Feinschliff** | Push-Erinnerungen für Fälligkeiten, Schweizer QR-Rechnung, Offline-Warteschlange für Änderungen, Backup-Automatik, Papierkorb | Die App denkt mit |

Etappen 0 bis 5 sind gebaut. Was in Etappe 6 noch aussteht, steht in der Tabelle oben;
nichts davon hält den täglichen Gebrauch auf.

---

## 13. Getroffene Entscheidungen

| Frage | Entscheid | Folge |
|---|---|---|
| Handy-Plattform | **Beide Android** | Web Share Target wird nativ gebaut, kein iOS-Kurzbefehl nötig |
| DNS `alae.app` | **Cloudflare** | Cloudflare Tunnel für `manager-api.alae.app`, keine offenen Ports |
| Container-Updates | **Watchtower** | Wie im Konzept beschrieben, identisch zur Share-App |
| Reihenfolge | **Etappe 0 → 1 → 2 → 3 → 4 → 5** | Fundament, Dokumente, Handy-Upload, Texterkennung, Alltag, Finanzen |
| Volltextsuche | **Vereinheitlichte Spalte statt FTS5** | Löst zusätzlich die Umlaut-Frage, die FTS5 hier nicht gelöst hätte |
| Zehnten-Rechnung | **Jahresrechnung, Steuern bei der Zahlung verrechnet** | Wer zahlt, weiss am besten, wie viel Steuern bis dahin angefallen sind – ein Zwölftel je Monat war bloss eine Annahme |
| Berechnungsbasis | **Kein Schalter, keine drei Modi** | „brutto" und „netto" sind dieselbe Rechnung mit einer anderen Zahl im Feld; wie viel Steuern abgezogen werden, entscheidet die Zahlung |
| Verrechenbare Steuern | **Ein Zehntel des Steuerbetrags** | Steuern mindern das Einkommen, nicht die Zahlung – von CHF 15 000 sind es CHF 1 500 |
| Zahlung erfassen | **Monate abhaken, Beträge rechnen lassen** | Der Zehnte steht im Einkommen; ein Eingabefeld dafür wäre nur eine Gelegenheit, sich zu vertippen |
| Jahresexport | **CSV, kein eigenes PDF** | Das Handy druckt jede Ansicht als PDF; eine eigene Erzeugung wäre Aufwand ohne Gewinn |

## 14. Noch offen

| # | Frage | Wann relevant |
|---|---|---|
| 1 | Speicherort der Ablage auf dem QNAP (welche Freigabe?) | Beim Einrichten des Containers – bis dahin gelten die Standardpfade |
| 2 | Claude API für Metadaten-Extraktion gewünscht? | Etappe 6; ohne funktioniert alles, mit wird das Ausfüllen komfortabler |
| 3 | Vorname deiner Frau für ihr Konto | Beim Anlegen des zweiten Kontos – die Finanzen beschriften die Felder mit den Kontonamen |

Das Image wird für **amd64 und arm64** gebaut – damit ist das QNAP-Modell irrelevant.
