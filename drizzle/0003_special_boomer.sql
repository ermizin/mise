CREATE TABLE `analytics_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`event_name` text NOT NULL,
	`flow_id` text,
	`duration_ms` integer,
	`error_code` text,
	`pilot_eligible` integer,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_analytics_events_actor_name_time` ON `analytics_events` (`actor_id`,`event_name`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_analytics_events_name_time` ON `analytics_events` (`event_name`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_analytics_events_flow` ON `analytics_events` (`flow_id`);