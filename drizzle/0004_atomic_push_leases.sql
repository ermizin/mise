ALTER TABLE `push_jobs` ADD `lease_until` integer;
--> statement-breakpoint
CREATE INDEX `idx_push_jobs_lease_until` ON `push_jobs` (`lease_until`);
