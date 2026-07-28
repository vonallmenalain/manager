# Einrichtung – QNAP, Cloudflare und Netlify

Einmalige Einrichtung. Danach genügt `git push`, alles Weitere passiert automatisch.

Rechne mit etwa 45 Minuten. Die Reihenfolge ist bewusst so gewählt, dass du am
Ende jedes Schritts etwas prüfen kannst, statt am Schluss vor einem stummen
System zu stehen.

---

## Übersicht

| Schritt | Wo | Dauer |
|---|---|---|
| 1 | GitHub: Image veröffentlichen und freigeben | 5 Min |
| 2 | Cloudflare: Tunnel anlegen | 10 Min |
| 3 | QNAP: Ordner anlegen | 5 Min |
| 4 | QNAP: Container starten | 10 Min |
| 5 | Cloudflare: `api.alae.app` verbinden | 5 Min |
| 6 | Netlify: Frontend veröffentlichen | 10 Min |
| 7 | Erste Anmeldung und Installation aufs Handy | 5 Min |

---

## Schritt 1 – Image veröffentlichen und freigeben

Bevor das QNAP etwas herunterladen kann, muss es das Image überhaupt geben.
Beides ist einmalig nötig: **bauen** und **lesbar machen**.

### 1a) Image bauen lassen

Der Workflow *Container veröffentlichen* baut das Image und legt es unter
`ghcr.io/vonallmenalain/manager-api:latest` ab. Er läuft automatisch bei jedem
Push auf `main`.

Solange es noch keinen `main`-Branch gibt, einmalig von Hand anstossen:
**GitHub → Actions → „Container veröffentlichen" → Run workflow**, dabei den
Entwicklungs-Branch auswählen.

Erst wenn dieser Lauf grün ist, existiert das Image.

### 1b) Paket lesbar machen

GitHub legt neue Pakete **immer privat** an – auch bei einem öffentlichen
Repository. Ohne Freigabe antwortet GHCR jedem anonymen Abruf mit `denied`,
egal ob das Image existiert oder nicht.

**Empfohlen – Paket öffentlich schalten:**

1. <https://github.com/vonallmenalain?tab=packages> → `manager-api`
2. **Package settings** → ganz unten **Danger Zone**
3. **Change visibility → Public**

Damit braucht das NAS keine Zugangsdaten, und Watchtower kann ohne Anmeldung
aktualisieren. Das Image enthält nur Anwendungscode, der ohnehin im
öffentlichen Repository liegt – alle Geheimnisse kommen erst zur Laufzeit aus
der `.env`.

**Alternative – Paket privat lassen:** Dann muss sich das NAS anmelden. Auf
GitHub unter *Settings → Developer settings → Personal access tokens* ein
Token mit der Berechtigung `read:packages` erzeugen und auf dem QNAP einmalig:

```sh
echo '<TOKEN>' | docker login ghcr.io -u vonallmenalain --password-stdin
```

Die Zugangsdaten landen in `~/.docker/config.json` und gelten auch für Watchtower.

### 1c) Prüfen

Auf dem QNAP:

```sh
docker pull ghcr.io/vonallmenalain/manager-api:latest
```

Das muss durchlaufen, bevor du weitermachst. Bei `denied` ist entweder der
Workflow aus 1a noch nicht fertig oder die Freigabe aus 1b fehlt.

---

## Schritt 2 – Cloudflare Tunnel anlegen

Der Tunnel baut die Verbindung **von deinem NAS nach aussen** auf. Dadurch
braucht die QNAP-Firewall keine eingehende Regel, dein Router kein
Port-Forwarding, und das Zertifikat für `api.alae.app` verwaltet Cloudflare.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) öffnen
2. **Networks → Tunnels → Create a tunnel**
3. Typ **Cloudflared** wählen, Name z.B. `qnap-manager`
4. Im nächsten Bildschirm den **Tunnel-Token** kopieren
   (die lange Zeichenkette nach `--token` im angezeigten Befehl)
5. Den Token bereithalten – er kommt in Schritt 4 in die `.env`

> Die Zuordnung zu `api.alae.app` machen wir erst in Schritt 5, wenn der
> Container schon läuft. Andersherum zeigt Cloudflare eine Weile Fehler an.

---

## Schritt 3 – Ordner auf dem QNAP anlegen

In der **File Station** zwei Ordner anlegen:

| Ordner | Zweck | Hinweis |
|---|---|---|
| `/share/Container/manager/data` | Datenbank | Muss auf einem **lokalen** Volume liegen, nie auf einer eingebundenen NFS-/SMB-Freigabe |
| `/share/Dokumente/Manager` | Dokumentenablage | Frei wählbar. Am besten dort, wo dein Backup ohnehin schon greift |

Danach per SSH die Benutzer-ID des Besitzers ermitteln – die brauchen wir,
damit der Container in die Ordner schreiben darf:

```sh
ssh admin@<nas-ip>
id admin
# Beispielausgabe: uid=1000(admin) gid=100(everyone) ...
```

Die beiden Zahlen (`uid` und `gid`) notieren.

---

## Schritt 4 – Container starten

### 4a) Dateien ablegen

`infra/docker-compose.yml` und `infra/.env.example` aus diesem Repository nach
`/share/Container/manager/` kopieren, dann:

```sh
cd /share/Container/manager
cp .env.example .env
```

### 4b) `.env` ausfüllen

```sh
# Zufallswerte erzeugen:
openssl rand -base64 48   # → SESSION_SECRET
openssl rand -hex 16      # → SETUP_TOKEN
```

Alle Werte eintragen:

```ini
SESSION_SECRET=<die 48-Byte-Zeichenkette>
SETUP_TOKEN=<die 16-Byte-Zeichenkette>
TUNNEL_TOKEN=<Token aus Schritt 2>
DATA_PATH=/share/Container/manager/data
STORAGE_PATH=/share/Dokumente/Manager
PUID=1000
PGID=100
```

`PUID`/`PGID` sind die Zahlen aus Schritt 3.

### 4c) Starten

In der **Container Station → Anwendungen → Erstellen** den Inhalt der
`docker-compose.yml` einfügen, oder per SSH:

```sh
cd /share/Container/manager
docker compose up -d
```

### 4d) Prüfen

```sh
docker compose logs -f manager-api
```

Erwartet wird eine Zeile wie:

```
Manager API bereit  version=... dbDir=/data storageDir=/storage
```

Und der Test von innen:

```sh
docker exec manager-api node -e \
  "fetch('http://127.0.0.1:8080/api/health').then(r=>r.text()).then(console.log)"
# → {"status":"ok","version":"...","uptime":12}
```

> **Bei `FEHLER: '/storage' ist für UID … nicht beschreibbar`:**
> `PUID`/`PGID` in der `.env` stimmen nicht mit dem Besitzer der Ordner überein.
> Auf dem NAS prüfen mit `ls -ldn /share/Dokumente/Manager` und die Werte anpassen.

---

## Schritt 5 – `api.alae.app` mit dem Tunnel verbinden

Zurück in Cloudflare Zero Trust, im angelegten Tunnel:

1. **Public Hostnames → Add a public hostname**
2. Subdomain: `api` · Domain: `alae.app`
3. Service: **HTTP** · URL: `manager-api:8080`
   (der Container-Name, nicht `localhost` – beide Container hängen im selben
   Docker-Netzwerk und finden sich über den Namen)
4. Speichern

Prüfen – jetzt von aussen, z.B. vom Handy im Mobilfunknetz:

```
https://api.alae.app/api/health
```

Es muss `{"status":"ok",...}` erscheinen. Falls nicht, zuerst in den
`cloudflared`-Logs nachsehen: `docker compose logs cloudflared`.

---

## Schritt 6 – Netlify

1. Auf [netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
2. Das Repository `vonallmenalain/manager` verbinden
3. Build-Einstellungen kommen aus `netlify.toml` und müssen nicht angepasst werden
4. Unter **Site configuration → Environment variables** eintragen:

   | Variable | Wert |
   |---|---|
   | `VITE_API_URL` | `https://api.alae.app` |

   > Wichtig: Vite backt diesen Wert beim Bauen fest ein. Wird er nachträglich
   > geändert, muss ein neuer Deploy angestossen werden.

5. Unter **Domain management** die Domain `manager.alae.app` hinzufügen
6. In Cloudflare DNS den von Netlify genannten CNAME anlegen –
   **grau (DNS only)**, nicht orange: Netlify liefert das Zertifikat selbst,
   ein zusätzlicher Cloudflare-Proxy davor führt nur zu Zertifikatskonflikten

Prüfen: `https://manager.alae.app` zeigt den Einrichtungsbildschirm.

---

## Schritt 7 – Erste Anmeldung

1. `https://manager.alae.app` auf dem Handy öffnen
2. Der Bildschirm **Ersteinrichtung** erscheint, weil noch kein Konto existiert
3. Name, E-Mail, Passwort und den **SETUP_TOKEN** aus der `.env` eingeben
4. Nach dem Anlegen bist du direkt angemeldet
5. Auf dem Dashboard unter *Haushalt* → **+ Mitglied hinzufügen** das Konto
   deiner Frau anlegen
6. In Chrome: **Menü → App installieren** – ab jetzt liegt Manager als
   eigenständige App auf dem Startbildschirm

**Danach aufräumen:** Die Zeile `SETUP_TOKEN=` in der `.env` löschen und
`docker compose up -d` erneut ausführen. Der Endpunkt ist zwar ohnehin
gesperrt, sobald ein Konto existiert – aber ein nicht vorhandenes Geheimnis
kann auch nicht verloren gehen.

---

## Wie Aktualisierungen ab jetzt ablaufen

```
git push auf main  →  GitHub Actions baut  →  GHCR  →  Watchtower zieht (max. 5 Min)  →  läuft
```

Für das Frontend baut Netlify parallel und veröffentlicht direkt.

> **Voraussetzung: ein `main`-Branch.** Die Entwicklung läuft auf
> Feature-Branches, veröffentlicht wird nur von `main`. Sobald der erste
> Branch dorthin zusammengeführt ist, greift die Automatik. Bis dahin lässt
> sich jeder Build von Hand anstossen (Actions → *Container veröffentlichen*
> → **Run workflow**).

**Kontrolle, ob eine Änderung angekommen ist:** `https://api.alae.app/api/health`
zeigt `version` (der Git-SHA des laufenden Standes) und `uptime` (Sekunden
seit dem letzten Neustart). Nach einem Deploy steht die `uptime` wieder bei
fast null.

Ein Deploy sofort erzwingen, statt auf Watchtower zu warten:

```sh
docker compose pull && docker compose up -d
```

---

## Sicherung

Zwei Dinge müssen gesichert werden:

| Was | Wo | Wie |
|---|---|---|
| Dokumente | `/share/Dokumente/Manager` | Hybrid Backup Sync oder Snapshots |
| Datenbank | `/share/Container/manager/data` | Ebenfalls einschliessen |

Für eine garantiert konsistente Kopie der Datenbank – SQLite schreibt während
des Betriebs – eine nächtliche Aufgabe im QNAP-Aufgabenplaner einrichten:

```sh
docker exec manager-api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/manager.sqlite', { readonly: true });
  db.backup('/storage/.backup/manager-' + new Date().toISOString().slice(0,10) + '.sqlite');
"
```

Damit landet ein sauberer Abzug im Storage-Ordner und wird vom normalen
Dokumenten-Backup mitgenommen.

---

## Fehlersuche

| Symptom | Wahrscheinliche Ursache |
|---|---|
| `docker pull` meldet `denied` | Das Image existiert noch nicht (Workflow aus Schritt 1a nie gelaufen) **oder** das Paket ist noch privat (Schritt 1b). GHCR unterscheidet die beiden Fälle für anonyme Abrufe nicht – die Meldung ist immer `denied` |
| `api.alae.app` nicht erreichbar | `cloudflared`-Container läuft nicht, oder Public Hostname zeigt auf `localhost` statt `manager-api:8080` |
| Anmeldung klappt, nach dem Neuladen wieder abgemeldet | `COOKIE_DOMAIN` ist nicht `.alae.app`, oder `VITE_API_URL` zeigt auf eine andere Domain als das Cookie |
| `permission denied` im Log | `PUID`/`PGID` passen nicht zum Besitzer der Ordner (Schritt 3) |
| Frontend zeigt „Keine Verbindung zum Server" | `VITE_API_URL` in Netlify fehlt oder ist falsch – nach Änderung neu deployen |
| Watchtower aktualisiert nicht | Label `com.centurylinklabs.watchtower.enable=true` fehlt am Container |
| Setup-Bildschirm erscheint erneut | Das `data`-Volume ist nicht korrekt gemountet – die Datenbank landet sonst im Container und ist nach jedem Update weg |
