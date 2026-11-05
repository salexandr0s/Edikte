ALTER TABLE `analyses` ADD `requested_model` text;--> statement-breakpoint
ALTER TABLE `analyses` ADD `account_label` text;--> statement-breakpoint
ALTER TABLE `edicts` ADD `corrected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `edicts` ADD `change_log` text DEFAULT '[]' NOT NULL;