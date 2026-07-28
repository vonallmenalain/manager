#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Rechte auf den QNAP-Freigaben
#
# Bind-Mounts vom NAS gehören dort einem bestimmten Benutzer. Läuft der
# Container unter einer anderen UID, scheitert der erste Schreibzugriff mit
# 'permission denied' – der klassische Stolperstein bei Container Station.
# Über PUID/PGID lässt sich die Laufzeit-Identität an die Freigabe angleichen,
# genau wie man es von anderen NAS-Containern kennt.
#
# Herausfinden lassen sich die Werte per SSH auf dem NAS:  id <benutzername>
# ---------------------------------------------------------------------------

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  groupmod -o -g "$PGID" node 2>/dev/null || true
  usermod -o -u "$PUID" -g "$PGID" node 2>/dev/null || true

  for dir in "$DB_DIR" "$STORAGE_DIR"; do
    mkdir -p "$dir"
    # Nur die Wurzel angleichen, nicht rekursiv: Bei zehntausenden Dokumenten
    # würde ein 'chown -R' den Start jedes Mal spürbar verzögern.
    chown "$PUID:$PGID" "$dir" 2>/dev/null || true
  done

  for dir in "$DB_DIR" "$STORAGE_DIR"; do
    if ! gosu node test -w "$dir"; then
      echo "FEHLER: '$dir' ist für UID $PUID nicht beschreibbar." >&2
      echo "" >&2
      echo "Auf dem NAS prüfen, wem der gemountete Ordner gehört:" >&2
      echo "  ls -ldn <pfad-auf-dem-nas>" >&2
      echo "und PUID/PGID in der docker-compose.yml entsprechend setzen." >&2
      exit 1
    fi
  done

  exec gosu node "$@"
fi

# Läuft der Container bereits ohne Root (z.B. via 'user:' in compose),
# übernehmen wir die vorgegebene Identität unverändert.
exec "$@"
