CREATE TABLE `cooking_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`signature` text NOT NULL,
	`plan_snapshot_signature` text NOT NULL,
	`graph` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_mutation_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cooking_sessions_client_plan_batch` ON `cooking_sessions` (`client_id`,`plan_id`,`batch_id`);
