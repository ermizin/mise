ALTER TABLE `meal_plans` ADD `client_id` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_meal_plans_client_updated_at` ON `meal_plans` (`client_id`,`updated_at`);
--> statement-breakpoint
PRAGMA optimize;
