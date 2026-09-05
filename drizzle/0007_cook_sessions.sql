CREATE TABLE `cook_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cook_sessions_client_plan` ON `cook_sessions` (`client_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `idx_cook_sessions_plan_updated_at` ON `cook_sessions` (`plan_id`,`updated_at`);--> statement-breakpoint
