CREATE TABLE `room_presence` (
	`room_code` text NOT NULL,
	`seat` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`room_code`, `seat`),
	FOREIGN KEY (`room_code`) REFERENCES `game_rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_room_presence_last_seen` ON `room_presence` (`last_seen_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `room_presence` (`room_code`, `seat`, `last_seen_at`)
SELECT `code`, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `game_rooms`;
--> statement-breakpoint
INSERT OR IGNORE INTO `room_presence` (`room_code`, `seat`, `last_seen_at`)
SELECT `code`, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `game_rooms`
WHERE json_extract(`state`, '$.tokens[1]') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_game_rooms_updated_at` ON `game_rooms` (`updated_at`);
