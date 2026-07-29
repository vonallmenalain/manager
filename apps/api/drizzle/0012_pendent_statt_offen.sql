PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`doc_date` text NOT NULL,
	`category_id` text,
	`assigned_to` text,
	`status` text DEFAULT 'pendent' NOT NULL,
	`due_date` text,
	`amount_cents` integer,
	`vendor` text,
	`notes` text,
	`search_text` text DEFAULT '' NOT NULL,
	`ocr_status` text DEFAULT 'pending' NOT NULL,
	`ocr_text` text,
	`ocr_method` text,
	`ocr_attempts` integer DEFAULT 0 NOT NULL,
	`ocr_error` text,
	`ocr_finished_at` text,
	`deleted_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "title", "storage_path", "mime_type", "size_bytes", "sha256", "uploaded_by", "uploaded_at", "doc_date", "category_id", "assigned_to", "status", "due_date", "amount_cents", "vendor", "notes", "search_text", "ocr_status", "ocr_text", "ocr_method", "ocr_attempts", "ocr_error", "ocr_finished_at", "deleted_at", "updated_at") SELECT "id", "title", "storage_path", "mime_type", "size_bytes", "sha256", "uploaded_by", "uploaded_at", "doc_date", "category_id", "assigned_to", "status", "due_date", "amount_cents", "vendor", "notes", "search_text", "ocr_status", "ocr_text", "ocr_method", "ocr_attempts", "ocr_error", "ocr_finished_at", "deleted_at", "updated_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `documents_status_idx` ON `documents` (`status`);--> statement-breakpoint
CREATE INDEX `documents_category_idx` ON `documents` (`category_id`);--> statement-breakpoint
CREATE INDEX `documents_assigned_idx` ON `documents` (`assigned_to`);--> statement-breakpoint
CREATE INDEX `documents_doc_date_idx` ON `documents` (`doc_date`);--> statement-breakpoint
CREATE INDEX `documents_sha256_idx` ON `documents` (`sha256`);--> statement-breakpoint
CREATE INDEX `documents_deleted_at_idx` ON `documents` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `documents_search_text_idx` ON `documents` (`search_text`);--> statement-breakpoint
CREATE INDEX `documents_ocr_status_idx` ON `documents` (`ocr_status`);--> statement-breakpoint
-- „Offen" und „In Arbeit" waren zwei Namen für dasselbe: etwas liegt an.
-- Beides heisst neu `pendent`; ohne diese Zeile stünden bestehende Dokumente
-- auf einem Zustand, den es nicht mehr gibt, und fielen aus jedem Filter.
UPDATE `documents` SET `status` = 'pendent' WHERE `status` IN ('offen', 'in_arbeit');
