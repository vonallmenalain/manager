CREATE TABLE `mortgage_amortizations` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`paid_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mortgage_amortizations_year_idx` ON `mortgage_amortizations` (`year`,`paid_on`);--> statement-breakpoint
CREATE TABLE `mortgage_interest` (
	`loan_id` text NOT NULL,
	`year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`loan_id`, `year`, `quarter`),
	FOREIGN KEY (`loan_id`) REFERENCES `mortgage_loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mortgage_interest_quarter_idx` ON `mortgage_interest` (`year`,`quarter`);--> statement-breakpoint
CREATE TABLE `mortgage_loans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'fest' NOT NULL,
	`amount_cents` integer NOT NULL,
	`rate_millipercent` integer DEFAULT 0 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mortgage_loans_start_idx` ON `mortgage_loans` (`start_date`);--> statement-breakpoint
CREATE TABLE `mortgage_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`property_value_cents` integer DEFAULT 0 NOT NULL,
	`mortgage_total_cents` integer DEFAULT 0 NOT NULL,
	`first_mortgage_cents` integer DEFAULT 0 NOT NULL,
	`amortization_per_year_cents` integer DEFAULT 0 NOT NULL,
	`carried_over_cents` integer DEFAULT 0 NOT NULL,
	`carried_over_date` text,
	`reference_rate_millipercent` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
