CREATE TABLE `alert_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filter_id` integer,
	`revision` integer NOT NULL,
	`discovery_id` integer NOT NULL,
	`state` text NOT NULL,
	`notification_id` integer,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`filter_id`) REFERENCES `saved_filters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`discovery_id`) REFERENCES `listing_discoveries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notification_id`) REFERENCES `notification_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_matches_discovery_idx` ON `alert_matches` (`filter_id`,`revision`,`discovery_id`);--> statement-breakpoint
CREATE INDEX `alert_matches_notification_idx` ON `alert_matches` (`notification_id`);--> statement-breakpoint
CREATE TABLE `filter_alerts` (
	`filter_id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`time` text DEFAULT '09:00' NOT NULL,
	`weekday` integer DEFAULT 1 NOT NULL,
	`desktop_enabled` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`query` text NOT NULL,
	`scope_key` text NOT NULL,
	`last_processed_discovery_id` integer DEFAULT 0 NOT NULL,
	`last_window_end_at` text NOT NULL,
	`next_due_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`filter_id`) REFERENCES `saved_filters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `listing_discoveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_key` text,
	`merged_into_id` integer,
	`source` text NOT NULL,
	`bundesland` text,
	`first_seen_at` text NOT NULL,
	`committed_at` text NOT NULL,
	`kind` text NOT NULL,
	`snapshot` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_discoveries_case_key_unique` ON `listing_discoveries` (`case_key`);--> statement-breakpoint
CREATE INDEX `listing_discoveries_committed_idx` ON `listing_discoveries` (`kind`,`committed_at`);--> statement-breakpoint
CREATE TABLE `notification_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filter_id` integer,
	`filter_name` text NOT NULL,
	`preset_key` text,
	`query` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`count` integer NOT NULL,
	`coverage` text NOT NULL,
	`read_at` text,
	`desktop_status` text NOT NULL,
	`desktop_error` text,
	`desktop_attempted_at` text,
	`pending_open_at` text,
	FOREIGN KEY (`filter_id`) REFERENCES `saved_filters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_batches_window_idx` ON `notification_batches` (`filter_id`,`revision`,`period_to`);
--> statement-breakpoint
INSERT INTO `listing_discoveries` (`case_key`, `source`, `bundesland`, `first_seen_at`, `committed_at`, `kind`)
SELECT `case_key`, `source`, `bundesland`, min(`first_seen_at`), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'baseline'
FROM `edicts` GROUP BY `case_key`;
