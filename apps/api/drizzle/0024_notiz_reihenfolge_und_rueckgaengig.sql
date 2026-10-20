-- Notizen lassen sich in eine eigene Reihenfolge bringen (`sort_order`) und
-- nach dem Löschen zurückholen (`deleted_at`). Bestehende Notizen stehen alle
-- auf 0 und ordnen sich damit wie bisher nach dem letzten Bearbeiten; keine
-- ist gelöscht.
ALTER TABLE `notes` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `notes_deleted_at_idx` ON `notes` (`deleted_at`);