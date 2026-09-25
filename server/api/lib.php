<?php
/* Shared code for the Yard Master leaderboard API and admin page. */

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

function ym_json(array $data, int $code = 200): never
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
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
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
        if (str_contains($flat, $bad)) {
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
 * Ranked board rows. $level is a level id or 'overall'; $week limits to one
 * week (null = all time). Returns the top rows plus the player's own row.
 */
function ym_board(string $level, ?string $week, ?string $playerId): array
{
    $db = ym_db();
    $params = [];
    $where = 's.hidden = 0 AND p.banned = 0';
    if ($week !== null) {
        $where .= ' AND s.week = ?';
        $params[] = $week;
    }

    if ($level === 'overall') {
        $ids = array_keys(ym_levels());
        if (!$ids) {
            return ['entries' => [], 'total' => 0];
        }
        $where .= ' AND s.level_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
        array_push($params, ...$ids);
        $sql = "WITH best AS (
                    SELECT s.*, p.name,
                           ROW_NUMBER() OVER (PARTITION BY s.player_id, s.level_id ORDER BY s.stars DESC, s.total_ms, s.shunts, s.created_at) AS rn
                    FROM ym_scores s JOIN ym_players p ON p.player_id = s.player_id
                    WHERE $where
                ), agg AS (
                    SELECT player_id, MAX(name) AS name, SUM(stars) AS stars, SUM(total_ms) AS total_ms,
                           SUM(shunts) AS shunts, SUM(contacts) AS contacts, MAX(created_at) AS created_at,
                           0 AS id, COUNT(*) AS n
                    FROM best WHERE rn = 1 GROUP BY player_id HAVING n = " . count($ids) . "
                ), ranked AS (
                    SELECT *, ROW_NUMBER() OVER (ORDER BY " . YM_ORDER . ") AS pos, COUNT(*) OVER () AS total FROM agg
                )
                SELECT * FROM ranked WHERE pos <= " . YM_BOARD_SIZE . " OR player_id = ? ORDER BY pos";
    } else {
        $where .= ' AND s.level_id = ?';
        $params[] = $level;
        $sql = "WITH best AS (
                    SELECT s.id, s.player_id, s.stars, s.total_ms, s.time_ms, s.shunts, s.contacts, s.created_at, p.name,
                           ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.stars DESC, s.total_ms, s.shunts, s.created_at) AS rn
                    FROM ym_scores s JOIN ym_players p ON p.player_id = s.player_id
                    WHERE $where
                ), ranked AS (
                    SELECT *, ROW_NUMBER() OVER (ORDER BY " . YM_ORDER . ") AS pos, COUNT(*) OVER () AS total
                    FROM best WHERE rn = 1
                )
                SELECT * FROM ranked WHERE pos <= " . YM_BOARD_SIZE . " OR player_id = ? ORDER BY pos";
    }
    $params[] = $playerId ?? '';
    $q = $db->prepare($sql);
    $q->execute($params);
    $rows = $q->fetchAll();

    $entries = [];
    $you = null;
    $total = 0;
    foreach ($rows as $r) {
        $total = (int) $r['total'];
        $e = [
            'pos' => (int) $r['pos'],
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
        if ($e['pos'] <= YM_BOARD_SIZE) {
            $entries[] = $e;
        }
    }
    return ['entries' => $entries, 'you' => $you, 'total' => $total];
}

function ym_h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
