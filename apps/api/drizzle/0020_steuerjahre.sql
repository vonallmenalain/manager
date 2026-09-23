CREATE TABLE `donation_tax_credits` (
	`donation_id` text NOT NULL,
	`tax_year` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`donation_id`, `tax_year`),
	FOREIGN KEY (`donation_id`) REFERENCES `donations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tax_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tax_entries_year_idx` ON `tax_entries` (`year`);--> statement-breakpoint
/*
 Die bisherigen Steuern übernehmen.

 Zu jedem Jahr gab es genau einen Steuerbetrag. Er wird zum ersten Eintrag
 seines Jahres – ohne Bezeichnung, denn eine hatte er nie. Jahre mit 0 hatten
 keine Steuern hinterlegt; sie entstanden beim ersten Aufruf von selbst.

 Die Kennung ist eine UUID wie überall sonst, hier in SQL zusammengesetzt.
*/
INSERT INTO `tax_entries` (`id`, `year`, `label`, `amount_cents`, `position`, `updated_by`, `updated_at`)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-' ||
    '4' || substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  `year`, '', `tax_cents`, 0, `updated_by`, `updated_at`
FROM `finance_years`
WHERE `tax_cents` > 0;--> statement-breakpoint
/*
 Bisher verrechnete eine Zahlung das Guthaben ihres eigenen Jahres – genau
 daher stammt es jetzt auch. Ohne diese Zeilen stünden die Steuern der
 vergangenen Jahre als unverrechnet da und liessen sich ein zweites Mal
 abziehen.
*/
INSERT INTO `donation_tax_credits` (`donation_id`, `tax_year`, `amount_cents`)
SELECT `id`, `year`, `tax_applied_cents`
FROM `donations`
WHERE `tax_applied_cents` > 0;--> statement-breakpoint
DROP TABLE `finance_years`;
