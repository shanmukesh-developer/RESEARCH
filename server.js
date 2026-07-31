const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* ═══════════════════════════════════════
   POSTGRESQL
   ═══════════════════════════════════════ */
let pool = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

async function initDB() {
    if (!pool) { console.log('⚠️  No DATABASE_URL — running without DB'); return; }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS visits (
                id         SERIAL PRIMARY KEY,
                visited_at TIMESTAMPTZ DEFAULT NOW(),
                user_agent TEXT,
                ip         TEXT
            )
        `);
        console.log('✅ Database initialized');
    } catch (err) {
        console.error('❌ DB init error:', err.message);
    }
}

/* ═══════════════════════════════════════
   STATIC FILES
   ═══════════════════════════════════════ */
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        /* no cache for HTML so visit counter updates */
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

/* ═══════════════════════════════════════
   API — Track visits
   ═══════════════════════════════════════ */
app.get('/api/visit', async (req, res) => {
    if (!pool) return res.json({ count: 0, success: false });
    try {
        const ua = req.headers['user-agent'] || '';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await pool.query(
            'INSERT INTO visits (user_agent, ip) VALUES ($1, $2)',
            [ua.substring(0, 500), ip.substring(0, 100)]
        );
        const result = await pool.query('SELECT COUNT(*) AS count FROM visits');
        res.json({ count: parseInt(result.rows[0].count), success: true });
    } catch (err) {
        console.error('Visit error:', err.message);
        res.json({ count: 0, success: false });
    }
});

/* API — Get visit count only (no insert) */
app.get('/api/visits', async (req, res) => {
    if (!pool) return res.json({ count: 0, success: false });
    try {
        const result = await pool.query('SELECT COUNT(*) AS count FROM visits');
        res.json({ count: parseInt(result.rows[0].count), success: true });
    } catch (err) {
        res.json({ count: 0, success: false });
    }
});

/* Health check */
app.get('/api/health', (req, res) => {
    res.json({ status: 'alive', uptime: process.uptime(), time: new Date().toISOString() });
});

/* ═══════════════════════════════════════
   START SERVER
   ═══════════════════════════════════════ */
app.listen(PORT, () => {
    console.log(`\n  💖 Server running on port ${PORT}`);
    console.log(`  🌐 http://localhost:${PORT}\n`);
    initDB();

    /* ─── Self-ping every 13 minutes to keep Render alive ─── */
    const selfUrl = process.env.RENDER_EXTERNAL_URL;
    if (selfUrl) {
        console.log(`  🏓 Self-ping enabled → ${selfUrl}/api/health (every 13 min)\n`);
        setInterval(() => {
            fetch(`${selfUrl}/api/health`)
                .then(() => console.log(`  🏓 Ping OK — ${new Date().toLocaleTimeString()}`))
                .catch(err => console.log(`  ⚠️  Ping failed: ${err.message}`));
        }, 13 * 60 * 1000);
    } else {
        console.log('  ℹ️  No RENDER_EXTERNAL_URL — self-ping disabled (local dev)\n');
    }
});
