-- In der DocBase gibt es kein „nur für mich": Die Sammlung gehört allen, die
-- sie öffnen dürfen. Neue und geänderte Notizen kommen deshalb immer geteilt
-- an (`upsertNoteSchema`); die schon abgelegten blieben ohne diese Zeile für
-- alle ausser ihrem Verfasser unsichtbar – und liessen sich von ihnen auch
-- nicht freigeben, denn öffnen kann man nur, was man sieht.
UPDATE `notes` SET `shared` = 1 WHERE `bereich` = 'docbase' AND `shared` = 0;
