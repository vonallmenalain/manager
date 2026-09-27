-- Die Formatierung einer Notiz (Fett, Farben, Grössen, Aufzählungen) steht als
-- JSON neben dem Text, nicht darin. Bestehende Notizen bleiben unverändert und
-- unformatiert (null); `body` ist weiterhin der lesbare Text, den Suche,
-- Vorschau und eine noch nicht aktualisierte App lesen.
ALTER TABLE `notes` ADD `body_rich` text;
