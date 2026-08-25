CREATE TABLE `push_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text DEFAULT '/' NOT NULL,
	`due_at` integer NOT NULL,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_jobs_due_at` ON `push_jobs` (`due_at`);--> statement-breakpoint
CREATE INDEX `idx_push_jobs_subscription_plan` ON `push_jobs` (`subscription_id`,`plan_id`);--> statement-breakpoint
CREATE TABLE `push_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`payload` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_preferences_subscription_plan` ON `push_preferences` (`subscription_id`,`plan_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`device_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_client_device` ON `push_subscriptions` (`client_id`,`device_id`);