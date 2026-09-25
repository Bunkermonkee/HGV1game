<?php
/*
 * Yard Master leaderboard API.
 *
 *   GET  ?action=ping
 *   GET  ?action=board&level=<level id | overall>&period=<week | all>&player=<id>
 *   GET  ?action=replay&id=<score id>
 *   POST ?action=submit   (JSON body – see ym_submit)
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

$action = $_GET['action'] ?? '';

try {
    switch ($action) {
        case 'ping':
            $version = (string) ym_db()->query('SELECT VERSION()')->fetchColumn();
            ym_json(['ok' => true, 'week' => ym_week(), 'today' => ym_today(), 'db' => $version, 'php' => PHP_VERSION]);
        case 'board':
            ym_board_action();
        case 'replay':
            ym_replay_action();
        case 'submit':
            ym_submit();
        default:
            ym_json(['ok' => false, 'error' => 'unknown_action'], 404);
    }
} catch (Throwable $e) {
    error_log('Yard Master API error: ' . $e->getMessage());
    ym_json(['ok' => false, 'error' => 'server_error'], 500);
}

function ym_valid_player(?string $id): ?string
{
    return ($id !== null && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) ? $id : null;
}

/** Level ids the server accepts: campaign levels, or today's / yesterday's Daily Yard. */
function ym_valid_level(string $id): bool
{
    if (isset(ym_levels()[$id])) {
        return true;
    }
    if (preg_match('/^daily-(\d{4}-\d{2}-\d{2})$/', $id, $m)) {
        $yesterday = (new DateTimeImmutable('yesterday', new DateTimeZone(YM_TZ)))->format('Y-m-d');
        return $m[1] === ym_today() || $m[1] === $yesterday;
    }
    return false;
}

function ym_board_action(): never
{
    $level = (string) ($_GET['level'] ?? '');
    $period = ($_GET['period'] ?? 'week') === 'all' ? 'all' : 'week';
    $player = ym_valid_player($_GET['player'] ?? null);
    $isDaily = str_starts_with($level, 'daily-');
    if ($level !== 'overall' && !isset(ym_levels()[$level]) && !($isDaily && preg_match('/^daily-\d{4}-\d{2}-\d{2}$/', $level))) {
        ym_json(['ok' => false, 'error' => 'unknown_level'], 400);
    }
    ym_rate_limit('board', 240, 600);
    // A Daily Yard only exists for one day, so it has a single board.
    $week = ($period === 'week' && !$isDaily) ? ym_week() : null;
    $board = ym_board($level, $week, $player);
    ym_json(['ok' => true, 'level' => $level, 'period' => $isDaily ? 'day' : $period, 'week' => ym_week()] + $board);
}

function ym_replay_action(): never
{
    $id = (int) ($_GET['id'] ?? 0);
    $q = ym_db()->prepare('SELECT s.*, p.name FROM ym_scores s JOIN ym_players p ON p.player_id = s.player_id
                           WHERE s.id = ? AND s.hidden = 0 AND p.banned = 0');
    $q->execute([$id]);
    $r = $q->fetch();
    if (!$r) {
        ym_json(['ok' => false, 'error' => 'not_found'], 404);
    }
    ym_json([
        'ok' => true,
        'name' => $r['name'],
        'levelId' => $r['level_id'],
        'stars' => (int) $r['stars'],
        'totalMs' => (int) $r['total_ms'],
        'timeMs' => (int) $r['time_ms'],
        'shunts' => (int) $r['shunts'],
        'contacts' => (int) $r['contacts'],
        'replay' => json_decode($r['replay'], true),
    ]);
}

function ym_int(array $a, string $k, int $min, int $max): int
{
    $v = $a[$k] ?? null;
    if (!is_int($v) || $v < $min || $v > $max) {
        ym_json(['ok' => false, 'error' => 'bad_' . $k], 400);
    }
    return $v;
}

/**
 * Record a finished run. Keeps each player's best run per level per week.
 * Body: { playerId, name, levelId, stars, timeMs, shunts, contacts, steps, replay }
 */
function ym_submit(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        ym_json(['ok' => false, 'error' => 'post_only'], 405);
    }
    $raw = file_get_contents('php://input', false, null, 0, YM_MAX_BODY + 1);
    if ($raw === false || strlen($raw) > YM_MAX_BODY) {
        ym_json(['ok' => false, 'error' => 'too_large'], 413);
    }
    $in = json_decode($raw, true);
    if (!is_array($in)) {
        ym_json(['ok' => false, 'error' => 'bad_json'], 400);
    }

    $player = ym_valid_player($in['playerId'] ?? null) ?? ym_json(['ok' => false, 'error' => 'bad_player'], 400);
    $name = ym_clean_name((string) ($in['name'] ?? '')) ?? ym_json(['ok' => false, 'error' => 'bad_name'], 400);
    $levelId = (string) ($in['levelId'] ?? '');
    if (!ym_valid_level($levelId)) {
        ym_json(['ok' => false, 'error' => 'bad_level'], 400);
    }
    $steps = ym_int($in, 'steps', 1, YM_MAX_STEPS);
    $timeMs = ym_int($in, 'timeMs', 0, YM_MAX_STEPS * 9);
    $shunts = ym_int($in, 'shunts', 0, 99);
    $contacts = ym_int($in, 'contacts', 0, 99);

    // Plausibility checks. The clock starts at the first pedal press, so it can't exceed the run length.
    if ($timeMs > $steps * YM_STEP_MS + 50) {
        ym_json(['ok' => false, 'error' => 'bad_time'], 400);
    }
    $level = ym_levels()[$levelId] ?? null;
    $minMs = $level['minTimeMs'] ?? 8000;
    if ($timeMs < $minMs) {
        ym_json(['ok' => false, 'error' => 'too_fast'], 400);
    }
    $totalMs = $timeMs + $contacts * YM_PENALTY_MS;
    // Campaign stars are worked out here; Daily Yard targets are generated in the game.
    $stars = $level ? ym_stars($level, $totalMs, $shunts, $contacts) : ym_int($in, 'stars', 1, 3);

    $replay = $in['replay'] ?? null;
    if (!is_array($replay) || ($replay['v'] ?? 0) !== 1 || ($replay['levelId'] ?? '') !== $levelId
        || ($replay['steps'] ?? -1) !== $steps || !is_array($replay['inputs'] ?? null) || !is_array($replay['checkpoints'] ?? null)
        || count($replay['checkpoints']) < intdiv($steps, 120)) {
        ym_json(['ok' => false, 'error' => 'bad_replay'], 400);
    }

    ym_rate_limit('submit', 30, 600);
    $db = ym_db();
    $now = ym_now();

    $q = $db->prepare('SELECT banned FROM ym_players WHERE player_id = ?');
    $q->execute([$player]);
    $existing = $q->fetch();
    if ($existing && (int) $existing['banned'] === 1) {
        ym_json(['ok' => false, 'error' => 'banned'], 403);
    }
    if ($existing) {
        $db->prepare('UPDATE ym_players SET name = ?, updated_at = ? WHERE player_id = ?')->execute([$name, $now, $player]);
    } else {
        $db->prepare('INSERT INTO ym_players (player_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
           ->execute([$player, $name, $now, $now]);
    }

    // Keep the better of this run and any earlier one this week.
    $week = ym_week();
    $q = $db->prepare('SELECT id, stars, total_ms, shunts FROM ym_scores WHERE player_id = ? AND level_id = ? AND week = ?');
    $q->execute([$player, $levelId, $week]);
    $prev = $q->fetch();
    $better = !$prev
        || $stars > (int) $prev['stars']
        || ($stars === (int) $prev['stars'] && ($totalMs < (int) $prev['total_ms']
            || ($totalMs === (int) $prev['total_ms'] && $shunts < (int) $prev['shunts'])));
    $replayJson = json_encode($replay, JSON_UNESCAPED_SLASHES);
    if (!$prev) {
        $db->prepare('INSERT INTO ym_scores (player_id, level_id, week, stars, total_ms, time_ms, shunts, contacts, replay, created_at, ip_hash)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
           ->execute([$player, $levelId, $week, $stars, $totalMs, $timeMs, $shunts, $contacts, $replayJson, $now, ym_ip_hash()]);
    } elseif ($better) {
        $db->prepare('UPDATE ym_scores SET stars = ?, total_ms = ?, time_ms = ?, shunts = ?, contacts = ?, replay = ?, created_at = ?, ip_hash = ?
                      WHERE id = ?')
           ->execute([$stars, $totalMs, $timeMs, $shunts, $contacts, $replayJson, $now, ym_ip_hash(), $prev['id']]);
    }

    $isDaily = str_starts_with($levelId, 'daily-');
    $weekBoard = ym_board($levelId, $isDaily ? null : $week, $player);
    $allBoard = $isDaily ? $weekBoard : ym_board($levelId, null, $player);
    ym_json([
        'ok' => true,
        'improved' => $better,
        'stars' => $stars,
        'week' => ['pos' => $weekBoard['you']['pos'] ?? null, 'total' => $weekBoard['total'], 'best' => $weekBoard['you']],
        'all' => ['pos' => $allBoard['you']['pos'] ?? null, 'total' => $allBoard['total']],
    ]);
}
