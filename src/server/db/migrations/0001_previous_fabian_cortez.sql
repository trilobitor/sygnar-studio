CREATE TABLE `login_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`outcome` text NOT NULL,
	`client_hash` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_events_created_at` ON `login_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`);