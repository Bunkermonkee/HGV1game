<?php
/*
 * Yard Master leaderboard settings.
 *
 * 1. Copy this file to "config.php" (same folder).
 * 2. Fill in the database details from IONOS: Hosting → Databases → your
 *    MySQL database. Host looks like db5000000000.hosting-data.io, the
 *    database name like dbs0000000 and the user like dbu0000000.
 * 3. Choose an admin password for api/admin.php.
 *
 * config.php is never overwritten when you upload a new version of the game.
 */
return [
    'db_host' => 'db5000000000.hosting-data.io',
    'db_name' => 'dbs0000000',
    'db_user' => 'dbu0000000',
    'db_pass' => 'your-database-password',

    // Password for the admin page (api/admin.php). Make it long.
    'admin_password' => 'change-me-to-something-long',

    // Any long random text. Used to anonymise IP addresses for rate limiting.
    'secret' => 'change-me-to-some-long-random-text',
];
