CREATE TABLE `electricity_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'abrechnung' NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`customer_number` text,
	`meter_point` text,
	`meter_number` text,
	`readings` text DEFAULT '[]' NOT NULL,
	`positions` text DEFAULT '[]' NOT NULL,
	`energy_cents` integer DEFAULT 0 NOT NULL,
	`grid_cents` integer DEFAULT 0 NOT NULL,
	`levies_cents` integer DEFAULT 0 NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`prepaid_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`vat_cents` integer DEFAULT 0 NOT NULL,
	`source_file` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `electricity_bills_invoice_number_unique` ON `electricity_bills` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `electricity_bills_period_idx` ON `electricity_bills` (`period_start`);--> statement-breakpoint
CREATE INDEX `electricity_bills_kind_idx` ON `electricity_bills` (`kind`);