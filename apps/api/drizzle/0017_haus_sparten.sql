CREATE TABLE `utility_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'abrechnung' NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`customer_number` text,
	`sections` text DEFAULT '[]' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`prepaid_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`vat_cents` integer DEFAULT 0 NOT NULL,
	`document_id` text,
	`source_file` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `utility_bills_invoice_number_unique` ON `utility_bills` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `utility_bills_period_idx` ON `utility_bills` (`period_start`);--> statement-breakpoint
CREATE INDEX `utility_bills_kind_idx` ON `utility_bills` (`kind`);--> statement-breakpoint
/*
 Die bereits erfassten Stromrechnungen übernehmen.

 Aus den drei Spalten energy/grid/levies wird die Sparte 'strom' mit ihren drei
 Blöcken, aus `kwh` je Ablesung die allgemeinere `quantity` samt Einheit. Ohne
 diesen Schritt wäre die neue Tabelle leer und jede Rechnung ein zweites Mal zu
 importieren – die Auswertung lebt aber gerade davon, dass mehrere Jahre
 nebeneinander stehen.

 json() um jeden verschachtelten Wert ist keine Zierde: Ohne den Aufruf hält
 SQLite das Ergebnis von json_object für eine gewöhnliche Zeichenkette und
 schreibt sie mit Anführungszeichen escaped in das äussere Objekt.
*/
INSERT INTO `utility_bills` (
  `id`, `kind`, `invoice_number`, `invoice_date`, `period_start`, `period_end`,
  `customer_number`, `sections`, `subtotal_cents`, `prepaid_cents`, `total_cents`,
  `vat_cents`, `document_id`, `source_file`, `note`, `created_by`, `created_at`, `updated_at`
)
SELECT
  `id`, `kind`, `invoice_number`, `invoice_date`, `period_start`, `period_end`,
  `customer_number`,
  json_array(json(json_object(
    'division', 'strom',
    'amountCents', `subtotal_cents`,
    'groups', json(json_array(
      json(json_object('group', 'energie', 'amountCents', `energy_cents`)),
      json(json_object('group', 'netznutzung', 'amountCents', `grid_cents`)),
      json(json_object('group', 'abgaben', 'amountCents', `levies_cents`))
    )),
    'readings', json(coalesce((
      SELECT json_group_array(json(json_object(
        'tariff', json_extract(`r`.`value`, '$.tariff'),
        'label', CASE json_extract(`r`.`value`, '$.tariff')
          WHEN 'hoch' THEN 'Wirkstrom Hochtarif'
          ELSE 'Wirkstrom Niedertarif'
        END,
        'unit', 'kWh',
        'startValue', json_extract(`r`.`value`, '$.startValue'),
        'endValue', json_extract(`r`.`value`, '$.endValue'),
        'quantity', json_extract(`r`.`value`, '$.kwh')
      )))
      FROM json_each(`electricity_bills`.`readings`) AS `r`
    ), '[]')),
    'positions', json(`positions`),
    'meterPoint', `meter_point`,
    'meterNumber', `meter_number`
  ))),
  `subtotal_cents`, `prepaid_cents`, `total_cents`, `vat_cents`,
  NULL, `source_file`, `note`, `created_by`, `created_at`, `updated_at`
FROM `electricity_bills`;--> statement-breakpoint
DROP TABLE `electricity_bills`;