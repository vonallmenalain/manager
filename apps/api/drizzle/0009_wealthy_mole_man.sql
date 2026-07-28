ALTER TABLE `donations` ADD `tax_applied_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `finance_years` DROP COLUMN `deduct_tax`;--> statement-breakpoint
ALTER TABLE `finance_years` DROP COLUMN `rate_basis_points`;--> statement-breakpoint
ALTER TABLE `finance_years` DROP COLUMN `settled_through_month`;