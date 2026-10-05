CREATE TABLE `game_events` (
	`match_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`state_version` integer NOT NULL,
	`type` text NOT NULL,
	`seat` integer,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `sequence`),
	FOREIGN KEY (`match_id`) REFERENCES `game_history`(`match_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `game_history` (
	`match_id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`player0_id` text NOT NULL,
	`player1_id` text,
	`base_score` integer NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`result` text,
	`final_version` integer,
	FOREIGN KEY (`player0_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player1_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_history_room_code_unique` ON `game_history` (`room_code`);--> statement-breakpoint
CREATE INDEX `idx_game_history_player0` ON `game_history` (`player0_id`,`finished_at`);--> statement-breakpoint
CREATE INDEX `idx_game_history_player1` ON `game_history` (`player1_id`,`finished_at`);
--> statement-breakpoint
INSERT INTO `game_history` (`match_id`, `room_code`, `player0_id`, `player1_id`, `base_score`, `created_at`, `finished_at`, `result`, `final_version`)
SELECT lower(hex(randomblob(16))), r.`code`,
  json_extract(r.`state`, '$.userIds[0]'),
  json_extract(r.`state`, '$.userIds[1]'),
  COALESCE(json_extract(r.`state`, '$.baseScore'), 5000),
  r.`updated_at`,
  CASE WHEN json_extract(r.`state`, '$.result') IS NOT NULL THEN r.`updated_at` ELSE NULL END,
  CASE WHEN json_extract(r.`state`, '$.result') IS NOT NULL THEN json_extract(r.`state`, '$.result') ELSE NULL END,
  CASE WHEN json_extract(r.`state`, '$.result') IS NOT NULL THEN json_extract(r.`state`, '$.version') ELSE NULL END
FROM `game_rooms` AS r
JOIN `users` AS player0 ON player0.`id` = json_extract(r.`state`, '$.userIds[0]')
LEFT JOIN `users` AS player1 ON player1.`id` = json_extract(r.`state`, '$.userIds[1]');
--> statement-breakpoint
INSERT INTO `game_events` (`match_id`, `sequence`, `state_version`, `type`, `seat`, `payload`, `created_at`)
SELECT h.`match_id`, 1, json_extract(r.`state`, '$.version'), 'match.restored', NULL,
  json_object('state', json_object(
    'baseScore', COALESCE(json_extract(r.`state`, '$.baseScore'), 5000),
    'pools', json_extract(r.`state`, '$.pools'),
    'hands', json_extract(r.`state`, '$.hands'),
    'reserves', json_extract(r.`state`, '$.reserves'),
    'discards', json_extract(r.`state`, '$.discards'),
    'counts', json_extract(r.`state`, '$.counts'),
    'temporaryFuriten', json_extract(r.`state`, '$.temporaryFuriten'),
    'indicator', json_extract(r.`state`, '$.indicator'),
    'uraIndicator', json_extract(r.`state`, '$.uraIndicator'),
    'opponentJoined', json_extract(r.`state`, '$.tokens[1]') IS NOT NULL,
    'turn', json_extract(r.`state`, '$.turn'),
    'pendingRon', json_extract(r.`state`, '$.pendingRon'),
    'pendingScore', json_extract(r.`state`, '$.pendingScore'),
    'lastDiscard', json_extract(r.`state`, '$.lastDiscard'),
    'result', json_extract(r.`state`, '$.result'),
    'turnDeadlineAt', json_extract(r.`state`, '$.turnDeadlineAt'),
    'version', json_extract(r.`state`, '$.version')
  )), r.`updated_at`
FROM `game_history` AS h
JOIN `game_rooms` AS r ON r.`code` = h.`room_code`;
--> statement-breakpoint
CREATE TRIGGER `trg_game_events_no_update`
BEFORE UPDATE ON `game_events`
BEGIN
  SELECT RAISE(ABORT, 'game events are immutable');
END;
