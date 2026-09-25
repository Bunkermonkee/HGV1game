<?php
/*
 * Yard Master leaderboard admin: moderate scores and names, watch replays,
 * export the week's winners. Password is set in config.php.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

session_name('ym_admin');
session_start(['cookie_httponly' => true, 'cookie_samesite' => 'Strict', 'cookie_secure' => !empty($_SERVER['HTTPS'])]);
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'");

$cfg = ym_config();
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf'];
$message = '';

// ---- Login / logout -----------------------------------------------------------
if (($_POST['do'] ?? '') === 'login') {
    ym_rate_limit('login', 10, 900);
    if (hash_equals((string) $cfg['admin_password'], (string) ($_POST['password'] ?? ''))
        && $cfg['admin_password'] !== 'change-me-to-something-long') {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        header('Location: admin.php');
        exit;
    }
    $message = 'Wrong password (or the password in config.php hasn\'t been changed yet).';
}
if (($_GET['do'] ?? '') === 'logout') {
    $_SESSION = [];
    session_destroy();
    header('Location: admin.php');
    exit;
}

if (empty($_SESSION['admin'])) {
    page_start('Yard Master admin – log in');
    echo '<form method="post" class="card narrow"><h1>Yard Master admin</h1>';
    if ($message) {
        echo '<p class="msg">' . ym_h($message) . '</p>';
    }
    echo '<input type="hidden" name="do" value="login">
          <label>Password <input type="password" name="password" autofocus required></label>
          <button>Log in</button></form>';
    page_end();
    exit;
}

$db = ym_db();
$levels = ym_levels();

// ---- Actions (POST + CSRF) ---------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Form expired – go back and try again.');
    }
    $do = $_POST['do'] ?? '';
    $id = (int) ($_POST['id'] ?? 0);
    $player = (string) ($_POST['player'] ?? '');
    if ($do === 'hide' || $do === 'unhide') {
        $db->prepare('UPDATE ym_scores SET hidden = ? WHERE id = ?')->execute([$do === 'hide' ? 1 : 0, $id]);
    } elseif ($do === 'ban' || $do === 'unban') {
        $db->prepare('UPDATE ym_players SET banned = ? WHERE player_id = ?')->execute([$do === 'ban' ? 1 : 0, $player]);
    } elseif ($do === 'rename') {
        $name = ym_clean_name((string) ($_POST['name'] ?? ''));
        if ($name !== null) {
            $db->prepare('UPDATE ym_players SET name = ?, updated_at = ? WHERE player_id = ?')->execute([$name, ym_now(), $player]);
        }
    } elseif ($do === 'delete') {
        $db->prepare('DELETE FROM ym_scores WHERE id = ?')->execute([$id]);
    }
    header('Location: admin.php?' . http_build_query(['level' => $_POST['level'] ?? '', 'week' => $_POST['week'] ?? '']));
    exit;
}

$week = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['week'] ?? '') ? ym_week($_GET['week']) : ym_week();
$level = (string) ($_GET['level'] ?? '');

// ---- CSV: this week's top 3 on every board --------------------------------------------
if (($_GET['do'] ?? '') === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="yardmaster-winners-' . $week . '.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Week starting', 'Board', 'Position', 'Name', 'Stars', 'Time', 'Shunts', 'Contacts'], ',', '"', '\\');
    $boards = array_merge(['overall' => ['name' => 'Overall (all 10 yards)']], $levels);
    foreach ($boards as $lid => $l) {
        foreach (array_slice(ym_board($lid, $week, null)['entries'], 0, 3) as $e) {
            fputcsv($out, [$week, $l['name'], $e['pos'], $e['name'], $e['stars'], fmt_ms($e['totalMs']), $e['shunts'], $e['contacts']], ',', '"', '\\');
        }
    }
    exit;
}

// ---- Score list ---------------------------------------------------------------
$params = [$week];
$sql = 'SELECT s.*, p.name, p.banned FROM ym_scores s JOIN ym_players p ON p.player_id = s.player_id WHERE s.week = ?';
if ($level !== '') {
    $sql .= ' AND s.level_id = ?';
    $params[] = $level;
}
$sql .= ' ORDER BY s.level_id, ' . YM_ORDER . ' LIMIT 500';
$q = $db->prepare($sql);
$q->execute($params);
$rows = $q->fetchAll();

$prevWeek = (new DateTime($week))->modify('-7 days')->format('Y-m-d');
$nextWeek = (new DateTime($week))->modify('+7 days')->format('Y-m-d');

page_start('Yard Master admin');
echo '<header class="bar"><h1>Yard Master leaderboard</h1><a href="?do=logout">Log out</a></header>';
echo '<form method="get" class="filters">
        <label>Board <select name="level" onchange="this.form.submit()"><option value="">All levels</option>';
foreach ($levels as $lid => $l) {
    echo '<option value="' . ym_h($lid) . '"' . ($lid === $level ? ' selected' : '') . '>' . ym_h($l['name']) . '</option>';
}
echo '</select></label>
        <input type="hidden" name="week" value="' . ym_h($week) . '">
        <span class="week"><a href="?' . ym_h(http_build_query(['level' => $level, 'week' => $prevWeek])) . '">◀</a>
          Week starting <strong>' . ym_h($week) . '</strong>
          <a href="?' . ym_h(http_build_query(['level' => $level, 'week' => $nextWeek])) . '">▶</a></span>
        <a class="button" href="?' . ym_h(http_build_query(['do' => 'csv', 'week' => $week])) . '">Download winners (CSV)</a>
      </form>';
echo '<p class="hint">Scores are each player\'s best per level for the week. Daily Yard scores are listed under their day\'s week.
      Hidden scores and banned players don\'t appear on the public boards.</p>';

echo '<table><thead><tr><th>Level</th><th>Name</th><th>Stars</th><th>Time</th><th>Shunts</th><th>Contacts</th><th>Posted</th><th>Replay</th><th>Actions</th></tr></thead><tbody>';
if (!$rows) {
    echo '<tr><td colspan="9" class="empty">No scores for this week yet.</td></tr>';
}
foreach ($rows as $r) {
    $cls = $r['hidden'] ? ' class="hidden-row"' : ($r['banned'] ? ' class="banned-row"' : '');
    $levelName = $levels[$r['level_id']]['name'] ?? $r['level_id'];
    $hidden = fields($csrf, $level, $week);
    echo "<tr$cls><td>" . ym_h($levelName) . '</td>
        <td>' . ym_h($r['name']) . ($r['banned'] ? ' <span class="tag">banned</span>' : '') . ($r['hidden'] ? ' <span class="tag">hidden</span>' : '') . '</td>
        <td>' . str_repeat('★', (int) $r['stars']) . '</td>
        <td>' . fmt_ms((int) $r['total_ms']) . '</td>
        <td>' . (int) $r['shunts'] . '</td>
        <td>' . (int) $r['contacts'] . '</td>
        <td>' . ym_h(substr($r['created_at'], 0, 16)) . '</td>
        <td><a href="../?replay=' . (int) $r['id'] . '" target="_blank" rel="noopener">▶ Watch</a></td>
        <td class="actions">
          <form method="post">' . $hidden . '<input type="hidden" name="id" value="' . (int) $r['id'] . '">
            <button name="do" value="' . ($r['hidden'] ? 'unhide' : 'hide') . '">' . ($r['hidden'] ? 'Unhide' : 'Hide') . '</button>
            <button name="do" value="delete" onclick="return confirm(\'Delete this score for good?\')">Delete</button></form>
          <form method="post">' . $hidden . '<input type="hidden" name="player" value="' . ym_h($r['player_id']) . '">
            <button name="do" value="' . ($r['banned'] ? 'unban' : 'ban') . '">' . ($r['banned'] ? 'Unban player' : 'Ban player') . '</button></form>
          <form method="post" class="rename">' . $hidden . '<input type="hidden" name="player" value="' . ym_h($r['player_id']) . '">
            <input name="name" value="' . ym_h($r['name']) . '" maxlength="20" aria-label="New name"><button name="do" value="rename">Rename</button></form>
        </td></tr>';
}
echo '</tbody></table>';
page_end();

// ---- Helpers ------------------------------------------------------------------

function fields(string $csrf, string $level, string $week): string
{
    return '<input type="hidden" name="csrf" value="' . ym_h($csrf) . '"><input type="hidden" name="level" value="' . ym_h($level) . '">'
        . '<input type="hidden" name="week" value="' . ym_h($week) . '">';
}

function fmt_ms(int $ms): string
{
    $s = $ms / 1000;
    return sprintf('%d:%04.1f', intdiv($ms, 60000), fmod($s, 60));
}

function page_start(string $title): void
{
    echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="robots" content="noindex"><title>' . ym_h($title) . '</title><style>
      body{font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:#f4f4f2;color:#16181b}
      h1{font-size:20px;margin:0}.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
      .card{background:#fff;border-top:6px solid #f85f00;border-radius:10px;padding:20px;display:grid;gap:12px}
      .narrow{max-width:340px;margin:10vh auto}.msg{color:#b00020;margin:0}
      label{display:grid;gap:4px;font-weight:600}input{font:inherit;padding:6px 8px;border:1px solid #bbb;border-radius:6px}
      button,.button{font:inherit;font-weight:600;padding:6px 10px;border-radius:6px;border:1px solid #16181b;background:#fff;color:#16181b;cursor:pointer;text-decoration:none}
      .card button{background:#f85f00;border-color:#f85f00;color:#16181b}
      .filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:8px}.filters label{display:flex;gap:6px;align-items:center}
      .week a{text-decoration:none;padding:0 6px}.hint{color:#555;margin:6px 0 12px;max-width:70ch}
      table{border-collapse:collapse;width:100%;background:#fff;font-variant-numeric:tabular-nums}
      th,td{padding:6px 8px;border-bottom:1px solid #e3e3e0;text-align:left;vertical-align:top}th{background:#16181b;color:#fff;position:sticky;top:0}
      .actions form{display:inline-flex;gap:4px;margin:0 6px 4px 0}.rename input{width:9em}
      .hidden-row{opacity:.55}.banned-row{background:#fff1f0}.tag{font-size:11px;background:#16181b;color:#fff;border-radius:4px;padding:1px 5px}
      .empty{text-align:center;color:#666;padding:24px}
      </style></head><body>';
}

function page_end(): void
{
    echo '</body></html>';
}
