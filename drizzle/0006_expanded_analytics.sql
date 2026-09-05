ALTER TABLE `analytics_events` ADD `step` integer;--> statement-breakpoint
ALTER TABLE `analytics_events` ADD `recipe_id` text;--> statement-breakpoint
CREATE INDEX `idx_analytics_events_recorded_at` ON `analytics_events` (`recorded_at`);
--> statement-breakpoint
PRAGMA optimize;
