ALTER TABLE `documents` ADD `removed_at` text;--> statement-breakpoint
ALTER TABLE `edicts` ADD `source` text DEFAULT 'court_auction' NOT NULL;--> statement-breakpoint
ALTER TABLE `edicts` ADD `insolvency` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `source` text DEFAULT 'court_auction' NOT NULL;