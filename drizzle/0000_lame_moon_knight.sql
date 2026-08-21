CREATE TABLE `meal_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meal_plans_updated_at` ON `meal_plans` (`updated_at`);
--> statement-breakpoint
PRAGMA optimize;
