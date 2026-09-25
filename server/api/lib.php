<?php
/*
 * Shared code for the Yard Master leaderboard API and admin page.
 * Written to run on PHP 7.4 and every PHP 8.x version.
 */

declare(strict_types=1);

const YM_TZ = 'Europe/London';
const YM_PENALTY_MS = 5000;       // per contact – must match the game's RULES
const YM_STEP_MS = 1000 / 120;    // fixed physics step
const YM_MAX_STEPS = 120 * 60 * 20; // 20 minutes
const YM_MAX_BODY = 400000;       // bytes
const YM_BOARD_SIZE = 20;
const YM_NAME_MAX = 20;

date_default_timezone_set(YM_TZ);

function ym_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/config.php';
        if (!is_file($file)) {
            ym_json(['ok' => false, 'error' => 'not_configured'], 503);
        }
        $cfg = require $file;
    }
    return $cfg;
}

function ym_db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = ym_config();
        $dsn = 'mysql:host=' . $c['db_host'] . ';dbname=' . $c['db_name'] . ';charset=utf8mb4';
        try {
            $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            error_log('Yard Master DB connect failed: ' . $e->getMessage());
            ym_json(['ok' => false, 'error' => 'db_unavailable'], 503);
        }
        ym_schema($pdo);
    }
    return $pdo;
}

/** Create the tables on first use. */
function ym_schema(PDO $db): void
{
    $db->exec("CREATE TABLE IF NOT EXISTS ym_players (
        player_id CHAR(36) NOT NULL PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        banned TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $db->exec("CREATE TABLE IF NOT EXISTS ym_scores (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        player_id CHAR(36) NOT NULL,
        level_id VARCHAR(40) NOT NULL,
        week CHAR(10) NOT NULL,
        stars TINYINT NOT NULL,
        total_ms INT NOT NULL,
        time_ms INT NOT NULL,
        shunts SMALLINT NOT NULL,
        contacts SMALLINT NOT NULL,
        replay MEDIUMTEXT NOT NULL,
        hidden TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        ip_hash CHAR(64) NOT NULL,
        UNIQUE KEY one_per_week (player_id, level_id, week),
        KEY board (level_id, week, hidden)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $db->exec("CREATE TABLE IF NOT EXISTS ym_rate (
        ip_hash CHAR(64) NOT NULL,
        action VARCHAR(16) NOT NULL,
        window_start INT UNSIGNED NOT NULL,
        hits INT UNSIGNED NOT NULL,
        PRIMARY KEY (ip_hash, action, window_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function ym_json(array $data, int $code = 200): void // never returns: always ends the request
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ym_now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone(YM_TZ)))->format('Y-m-d H:i:s');
}

/** Monday (UK time) of the week containing $date, as Y-m-d. The weekly board resets at Monday 00:00. */
function ym_week(?string $date = null): string
{
    $d = new DateTime($date ?? 'now', new DateTimeZone(YM_TZ));
    $d->setISODate((int) $d->format('o'), (int) $d->format('W'), 1);
    return $d->format('Y-m-d');
}

function ym_today(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone(YM_TZ)))->format('Y-m-d');
}

function ym_ip_hash(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return hash_hmac('sha256', $ip, (string) ym_config()['secret']);
}

/** Allow at most $max hits per $window seconds per IP for an action. */
function ym_rate_limit(string $action, int $max, int $window): void
{
    $db = ym_db();
    $start = intdiv(time(), $window) * $window;
    $ip = ym_ip_hash();
    $db->prepare('INSERT INTO ym_rate (ip_hash, action, window_start, hits) VALUES (?, ?, ?, 1)
                  ON DUPLICATE KEY UPDATE hits = hits + 1')->execute([$ip, $action, $start]);
    $q = $db->prepare('SELECT hits FROM ym_rate WHERE ip_hash = ? AND action = ? AND window_start = ?');
    $q->execute([$ip, $action, $start]);
    if ((int) $q->fetchColumn() > $max) {
        ym_json(['ok' => false, 'error' => 'slow_down'], 429);
    }
    // Tidy up old windows now and then.
    if (random_int(1, 50) === 1) {
        $db->prepare('DELETE FROM ym_rate WHERE window_start < ?')->execute([time() - 86400]);
    }
}

/** Campaign level data written at build time (ids, star targets, minimum times). */
function ym_levels(): array
{
    static $levels = null;
    if ($levels === null) {
        $raw = @file_get_contents(__DIR__ . '/levels.json');
        $levels = [];
        foreach (json_decode($raw ?: '[]', true) ?: [] as $l) {
            $levels[$l['id']] = $l;
        }
    }
    return $levels;
}

/** Tidy a display name; returns null if it isn't acceptable. */
function ym_clean_name(string $name): ?string
{
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '', " \t\n\r\0\x0B");
    if (!preg_match("/^[\\p{L}\\p{N} '.&!\\-]{2,40}$/u", $name)) {
        return null;
    }
    if (mb_strlen($name) > YM_NAME_MAX) {
        return null;
    }
    // Basic language filter; anything that slips through can be renamed or banned in admin.php.
    $flat = strtr(mb_strtolower($name), ['0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '7' => 't', '@' => 'a', '$' => 's']);
    $flat = preg_replace('/[^a-z]/', '', $flat) ?? '';
    // Real places and surnames that contain a rude word (the "Scunthorpe problem").
    $flat = str_replace(['scunthorpe', 'penistone', 'shitterton'], '', $flat);
    // Deliberately no "cock" or "dick": Hancock, Peacock and Dickinson are real surnames.
    foreach (['fuck', 'fuk', 'fck', 'fcuk', 'phuck', 'shit', 'cunt', 'kunt', 'wank', 'twat', 'tosser', 'bollock', 'bastard',
              'knobhead', 'dickhead', 'bellend', 'pussy', 'whore', 'slut', 'nigg', 'paki', 'faggot', 'spastic', 'retard', 'nonce',
              'rapist', 'hitler', 'nazi'] as $bad) {
        if (strpos($flat, $bad) !== false) {
            return null;
        }
    }
    return $name;
}

/** Star rating from the level's targets. */
function ym_stars(array $level, int $totalMs, int $shunts, int $contacts): int
{
    $three = $level['stars']['three'];
    $two = $level['stars']['two'];
    if ($shunts <= $three['shunts'] && $totalMs <= $three['time'] * 1000 && $contacts === 0) {
        return 3;
    }
    if ($shunts <= $two['shunts'] && $totalMs <= $two['time'] * 1000) {
        return 2;
    }
    return 1;
}

/** Ranking order used everywhere: more stars, then less time, then fewer shunts, then earliest. */
const YM_ORDER = 'stars DESC, total_ms ASC, shunts ASC, created_at ASC, id ASC';

/**
 * Sortable key for "better run": fewer is better. More stars first, then
 * less total time, then fewer shunts. Used to pick each player's best row in
 * plain SQL (no window functions, so it works on MySQL 5.7 as well as 8).
 */
const YM_KEY = '((3 - %1$sstars) * 1000000000000 + %1$stotal_ms * 1000 + LEAST(%1$sshunts, 999))';

function ym_key(string $alias = ''): string
{
    return sprintf(YM_KEY, $alias === '' ? '' : $alias . '.');
}

/** Order two rows best-first (matches YM_ORDER). */
function ym_cmp(array $a, array $b): int
{
    return [(int) $b['stars'], (int) $a['total_ms'], (int) $a['shunts'], $a['created_at'], (int) $a['id']]
       <=> [(int) $a['stars'], (int) $b['total_ms'], (int) $b['shunts'], $b['created_at'], (int) $b['id']];
}

/**
 * Each player's best row per level. $levels: level ids; $week: one week or
 * null for all time. Returns rows keyed "player|level".
 */
function ym_best_rows(array $levels, ?string $week): array
{
    $in = implode(',', array_fill(0, count($levels), '?'));
    $weekSql = $week !== null ? ' AND week = ?' : '';
    $params = $levels;
    if ($week !== null) {
        $params[] = $week;
    }
    $sql = 'SELECT s.id, s.player_id, s.level_id, s.stars, s.total_ms, s.shunts, s.contacts, s.created_at, p.name
            FROM ym_scores s
            JOIN (SELECT player_id, level_id, MIN(' . ym_key() . ") AS k
                  FROM ym_scores WHERE level_id IN ($in) AND hidden = 0$weekSql
                  GROUP BY player_id, level_id) b
              ON b.player_id = s.player_id AND b.level_id = s.level_id AND b.k = " . ym_key('s') . "
            JOIN ym_players p ON p.player_id = s.player_id
            WHERE s.level_id IN ($in) AND s.hidden = 0" . ($week !== null ? ' AND s.week = ?' : '') . ' AND p.banned = 0';
    $q = ym_db()->prepare($sql);
    $q->execute(array_merge($params, $params));
    $best = [];
    foreach ($q->fetchAll() as $r) {
        $k = $r['player_id'] . '|' . $r['level_id'];
        // Two equally good runs (e.g. in different weeks): keep the earlier one.
        if (!isset($best[$k]) || ym_cmp($r, $best[$k]) < 0) {
            $best[$k] = $r;
        }
    }
    return $best;
}

/**
 * Ranked board rows. $level is a level id or 'overall'; $week limits to one
 * week (null = all time). Returns the top rows plus the player's own row.
 */
function ym_board(string $level, ?string $week, ?string $playerId): array
{
    if ($level === 'overall') {
        $ids = array_keys(ym_levels());
        if (!$ids) {
            return ['entries' => [], 'you' => null, 'total' => 0];
        }
        // Sum each player's best on every campaign level; only players who have done them all.
        $players = [];
        foreach (ym_best_rows($ids, $week) as $r) {
            $p = &$players[$r['player_id']];
            $p ??= ['player_id' => $r['player_id'], 'name' => $r['name'], 'stars' => 0, 'total_ms' => 0, 'shunts' => 0,
                    'contacts' => 0, 'created_at' => '', 'id' => 0, 'n' => 0];
            $p['stars'] += (int) $r['stars'];
            $p['total_ms'] += (int) $r['total_ms'];
            $p['shunts'] += (int) $r['shunts'];
            $p['contacts'] += (int) $r['contacts'];
            $p['created_at'] = max($p['created_at'], $r['created_at']);
            $p['n']++;
            unset($p);
        }
        $rows = array_values(array_filter($players, fn ($p) => $p['n'] === count($ids)));
    } else {
        $rows = array_values(ym_best_rows([$level], $week));
    }
    usort($rows, 'ym_cmp');

    $entries = [];
    $you = null;
    foreach ($rows as $i => $r) {
        $e = [
            'pos' => $i + 1,
            'name' => $r['name'],
            'stars' => (int) $r['stars'],
            'totalMs' => (int) $r['total_ms'],
            'shunts' => (int) $r['shunts'],
            'contacts' => (int) $r['contacts'],
            'id' => (int) $r['id'],
            'you' => $playerId !== null && $r['player_id'] === $playerId,
        ];
        if ($e['you']) {
            $you = $e;
        }
        if ($i < YM_BOARD_SIZE) {
            $entries[] = $e;
        }
    }
    return ['entries' => $entries, 'you' => $you, 'total' => count($rows)];
}

function ym_h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
