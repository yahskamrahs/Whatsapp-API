const { makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const QRCode = require('qrcode')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { exec } = require('child_process')
const { promisify } = require('util')
const Database = require('better-sqlite3')

const execAsync = promisify(exec)

// Initialize SQLite database for logs and config
const dbPath = process.env.SQLITE_DB_PATH || (process.env.NODE_ENV === 'production' ? '/app/data/logs.db' : 'logs.db')
const db = new Database(dbPath)

// Create tables if not exists
db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT UNIQUE NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);

    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auto_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_word TEXT UNIQUE NOT NULL,
        reply_message TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pdf_compression_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT UNIQUE NOT NULL,
        webhook_url TEXT NOT NULL,
        original_filename TEXT,
        compressed_filename TEXT,
        status TEXT DEFAULT 'processing', -- processing, completed, failed
        original_size INTEGER,
        compressed_size INTEGER,
        compression_ratio REAL,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
    );
`)

const DEFAULT_BUSINESS_ID = 'test-business'
const SESSION_COOKIE = 'baileys_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function hasColumn(table, column) {
    return db.pragma(`table_info(${table})`).some(item => item.name === column)
}

function addColumnIfMissing(table, column, definition) {
    if (!hasColumn(table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
}

function hashSecret(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex')
    return { salt, passwordHash }
}

function migrateTenantSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS businesses (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            notes TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            business_id TEXT,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('superadmin', 'business')),
            must_change_password INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            business_id TEXT,
            impersonated_by TEXT,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS business_api_keys (
            id TEXT PRIMARY KEY,
            business_id TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT 'Default key',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used_at TEXT,
            revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_business_api_keys_business ON business_api_keys(business_id);
        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id TEXT,
            business_id TEXT,
            action TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `)

    const transaction = db.transaction(() => {
        db.prepare(`
            INSERT OR IGNORE INTO businesses (id, name, phone, email)
            VALUES (?, ?, NULL, ?)
        `).run(DEFAULT_BUSINESS_ID, 'Test Business', 'test@test.com')

        addColumnIfMissing('logs', 'business_id', 'TEXT')
        addColumnIfMissing('auto_replies', 'business_id', 'TEXT')
        addColumnIfMissing('pdf_compression_jobs', 'business_id', 'TEXT')

        const autoReplySchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auto_replies'").get()?.sql || ''
        if (/trigger_word\s+TEXT\s+UNIQUE/i.test(autoReplySchema)) {
            db.exec('ALTER TABLE auto_replies RENAME TO auto_replies_legacy')
            db.exec(`
                CREATE TABLE auto_replies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    business_id TEXT NOT NULL,
                    trigger_word TEXT NOT NULL,
                    reply_message TEXT NOT NULL,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (business_id, trigger_word)
                )
            `)
            db.prepare(`
                INSERT INTO auto_replies (id, business_id, trigger_word, reply_message, is_active, created_at, updated_at)
                SELECT id, COALESCE(business_id, ?), trigger_word, reply_message, is_active, created_at, updated_at
                FROM auto_replies_legacy
            `).run(DEFAULT_BUSINESS_ID)
            db.exec('DROP TABLE auto_replies_legacy')
        }

        db.prepare('UPDATE logs SET business_id = ? WHERE business_id IS NULL').run(DEFAULT_BUSINESS_ID)
        db.prepare('UPDATE auto_replies SET business_id = ? WHERE business_id IS NULL').run(DEFAULT_BUSINESS_ID)
        db.prepare('UPDATE pdf_compression_jobs SET business_id = ? WHERE business_id IS NULL').run(DEFAULT_BUSINESS_ID)

        const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
        if (users === 0) {
            const admin = hashPassword('admin123')
            const businessUser = hashPassword('Test123')
            db.prepare(`
                INSERT INTO users (id, business_id, username, password_hash, password_salt, role, must_change_password)
                VALUES (?, NULL, ?, ?, ?, 'superadmin', 1)
            `).run(crypto.randomUUID(), 'superadmin@admin.com', admin.passwordHash, admin.salt)
            db.prepare(`
                INSERT INTO users (id, business_id, username, password_hash, password_salt, role, must_change_password)
                VALUES (?, ?, ?, ?, ?, 'business', 1)
            `).run(crypto.randomUUID(), DEFAULT_BUSINESS_ID, 'test@test.com', businessUser.passwordHash, businessUser.salt)
        }

        const legacyKey = db.prepare('SELECT value FROM config WHERE key = ?').get('api_key')?.value
        const existingDefaultKey = db.prepare(`
            SELECT id FROM business_api_keys WHERE business_id = ? AND revoked_at IS NULL LIMIT 1
        `).get(DEFAULT_BUSINESS_ID)
        if (legacyKey) {
            db.prepare(`
                INSERT OR IGNORE INTO business_api_keys (id, business_id, key_hash, key_prefix, label)
                VALUES (?, ?, ?, ?, ?)
            `).run(crypto.randomUUID(), DEFAULT_BUSINESS_ID, hashSecret(legacyKey), legacyKey.slice(0, 10), 'Migrated API key')
        } else if (!existingDefaultKey) {
            const generatedKey = `wa_${crypto.randomBytes(24).toString('hex')}`
            db.prepare(`
                INSERT INTO business_api_keys (id, business_id, key_hash, key_prefix, label)
                VALUES (?, ?, ?, ?, ?)
            `).run(crypto.randomUUID(), DEFAULT_BUSINESS_ID, hashSecret(generatedKey), generatedKey.slice(0, 10), 'Default API key')
        }
        db.prepare('DELETE FROM config WHERE key = ?').run('api_key')

        db.exec('CREATE INDEX IF NOT EXISTS idx_logs_business_timestamp ON logs(business_id, timestamp DESC)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_logs_business_type ON logs(business_id, type)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_auto_replies_business ON auto_replies(business_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_pdf_jobs_business ON pdf_compression_jobs(business_id)')
    })

    transaction()
}

migrateTenantSchema()

// Initialize default auto-reply rules
function initializeAutoReplies(businessId = DEFAULT_BUSINESS_ID) {
    const defaultReplies = [
        { trigger_word: 'bong', reply_message: 'bing' },
        { trigger_word: 'hello', reply_message: 'Hi there! 👋' },
        { trigger_word: 'ping', reply_message: 'pong 🏓' }
    ]

    const checkExisting = db.prepare('SELECT COUNT(*) as count FROM auto_replies WHERE business_id = ?')
    if (checkExisting.get(businessId).count === 0) {
        const insertReply = db.prepare('INSERT OR IGNORE INTO auto_replies (business_id, trigger_word, reply_message) VALUES (?, ?, ?)')
        for (const reply of defaultReplies) {
            insertReply.run(businessId, reply.trigger_word, reply.reply_message)
        }
        console.log('📝 Initialized default auto-reply rules')
    }
}

// Call initialization
initializeAutoReplies()

// Prepared statements for better performance
const insertLog = db.prepare(`
    INSERT INTO logs (uid, timestamp, type, message, details, business_id)
    VALUES (?, ?, ?, ?, ?, ?)
`)

const getLogs = db.prepare(`
    SELECT uid as id, timestamp, type, message, details 
    FROM logs WHERE business_id = ?
    ORDER BY timestamp DESC 
    LIMIT ? OFFSET ?
`)

const getLogsByType = db.prepare(`
    SELECT uid as id, timestamp, type, message, details 
    FROM logs 
    WHERE business_id = ? AND type = ?
    ORDER BY timestamp DESC 
    LIMIT ? OFFSET ?
`)

const getLogsSince = db.prepare(`
    SELECT uid as id, timestamp, type, message, details 
    FROM logs 
    WHERE business_id = ? AND timestamp > ?
    ORDER BY timestamp DESC 
    LIMIT ? OFFSET ?
`)

const getLogsByTypeAndSince = db.prepare(`
    SELECT uid as id, timestamp, type, message, details 
    FROM logs 
    WHERE business_id = ? AND type = ? AND timestamp > ?
    ORDER BY timestamp DESC 
    LIMIT ? OFFSET ?
`)

const countLogs = db.prepare(`SELECT COUNT(*) as total FROM logs WHERE business_id = ?`)
const countLogsByType = db.prepare(`SELECT COUNT(*) as total FROM logs WHERE business_id = ? AND type = ?`)

const clearAllLogs = db.prepare(`DELETE FROM logs WHERE business_id = ?`)

const getLogStats = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM logs WHERE business_id = ?
    GROUP BY type
`)

const businessRuntimes = new Map()

function getBusinessRuntime(businessId = DEFAULT_BUSINESS_ID) {
    if (!businessRuntimes.has(businessId)) {
        businessRuntimes.set(businessId, {
            sock: null,
            connectionStatus: 'disconnected',
            connectedNumber: null,
            pairingQr: null,
            connectionError: null
        })
    }
    return businessRuntimes.get(businessId)
}

function authDirectoryForBusiness(businessId) {
    const root = process.env.WHATSAPP_AUTH_ROOT || (process.env.NODE_ENV === 'production' ? '/app/auth_info_baileys' : 'auth_info_baileys')
    return businessId === DEFAULT_BUSINESS_ID ? root : path.join(root, 'businesses', businessId)
}

// Log helper function - now saves to SQLite
function addLog(type, message, details = {}, businessId = DEFAULT_BUSINESS_ID) {
    const uid = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    const timestamp = new Date().toISOString()
    const detailsJson = JSON.stringify(details)
    
    try {
        insertLog.run(uid, timestamp, type, message, detailsJson, businessId)
    } catch (err) {
        console.error('Failed to save log to database:', err.message)
    }
    
    // Also log to console
    const emoji = {
        'info': 'ℹ️',
        'error': '❌',
        'message_in': '📨',
        'message_out': '📤',
        'connection': '🔗',
        'api': '🌐'
    }[type] || '📝'
    console.log(`${emoji} [${type.toUpperCase()}] ${message}`)
    
    return { id: uid, timestamp, type, message, details }
}

// Express API Server Setup
const app = express()
const PORT = process.env.PORT || 3001

// Middleware
const dashboardOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.DASHBOARD_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
])
app.use(cors((req, callback) => {
    const origin = req.get('Origin')
    if (!origin) return callback(null, { credentials: true })
    const requestOrigin = `${req.protocol}://${req.get('host')}`
    if (origin === requestOrigin || dashboardOrigins.has(origin)) {
        return callback(null, { origin: true, credentials: true })
    }
    callback(null, { origin: false, credentials: true })
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Multer setup for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
})

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads')
}

// API Key Authentication Middleware
function getCookie(req, name) {
    const cookies = (req.headers.cookie || '').split(';')
    const value = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${name}=`))
    return value ? decodeURIComponent(value.slice(name.length + 1)) : null
}

function setSessionCookie(req, res, token) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production'
    const flags = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`]
    if (secure) flags.push('Secure')
    res.setHeader('Set-Cookie', flags.join('; '))
}

function clearSessionCookie(req, res) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production'
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`)
}

function createAuthSession(userId, businessId = null, impersonatedBy = null) {
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashSecret(token)
    const expiresAt = Date.now() + SESSION_TTL_MS
    db.prepare(`
        INSERT INTO auth_sessions (token_hash, user_id, business_id, impersonated_by, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, userId, businessId, impersonatedBy, expiresAt)
    return { token, tokenHash, expiresAt }
}

function findAuthSession(token) {
    if (!token) return null
    const tokenHash = hashSecret(token)
    const session = db.prepare(`
        SELECT s.token_hash, s.user_id, s.business_id, s.impersonated_by, s.expires_at,
               u.username, u.role, u.must_change_password, u.is_active,
               b.name AS business_name, b.is_active AS business_active
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN businesses b ON b.id = s.business_id
        WHERE s.token_hash = ?
    `).get(tokenHash)
    if (!session || session.expires_at <= Date.now() || !session.is_active || (session.business_id && !session.business_active)) {
        if (session) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash)
        return null
    }
    db.prepare('UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run(tokenHash)
    return {
        userId: session.user_id,
        username: session.username,
        role: session.role,
        businessId: session.business_id,
        businessName: session.business_name,
        mustChangePassword: Boolean(session.must_change_password),
        impersonatedBy: session.impersonated_by,
        sessionHash: session.token_hash,
        source: 'session'
    }
}

function authenticateApiKey(req, res, next) {
    const session = findAuthSession(getCookie(req, SESSION_COOKIE))
    if (session) {
        req.auth = session
    } else {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.api_key
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'Login required' })
        }
        const key = db.prepare(`
            SELECT k.business_id, b.name AS business_name
            FROM business_api_keys k
            JOIN businesses b ON b.id = k.business_id
            WHERE k.key_hash = ? AND k.revoked_at IS NULL AND b.is_active = 1
        `).get(hashSecret(String(apiKey)))
        if (!key) {
            addLog('error', 'Invalid API key attempt', { ip: req.ip, path: req.path })
            return res.status(403).json({ success: false, error: 'Invalid or revoked API key' })
        }
        db.prepare('UPDATE business_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?').run(hashSecret(String(apiKey)))
        req.auth = { role: 'business_api', businessId: key.business_id, businessName: key.business_name, source: 'api_key' }
    }

    const passwordChangeRoute = req.path === '/auth/me' || req.path === '/auth/change-password' || req.path === '/auth/logout'
    if (req.auth.mustChangePassword && !passwordChangeRoute) {
        return res.status(428).json({ success: false, error: 'Change your temporary password before continuing' })
    }

    const authRoute = req.path.startsWith('/auth/')
    const adminRoute = req.path.startsWith('/admin/')
    if (!authRoute && !adminRoute && !req.auth.businessId) {
        return res.status(403).json({ success: false, error: 'Select or impersonate a business before accessing business data' })
    }
    next()
}

function requireSuperadmin(req, res, next) {
    if (req.auth?.role !== 'superadmin' || req.auth.source !== 'session') {
        return res.status(403).json({ success: false, error: 'Superadmin access required' })
    }
    next()
}

function auditEvent(req, action, businessId = req.auth?.businessId, details = {}) {
    db.prepare(`
        INSERT INTO audit_events (actor_user_id, business_id, action, details)
        VALUES (?, ?, ?, ?)
    `).run(req.auth?.userId || null, businessId || null, action, JSON.stringify(details))
}

// Public endpoints (no auth required)
app.get('/health', (req, res) => {
    const runtime = getBusinessRuntime(DEFAULT_BUSINESS_ID)
    res.json({
        status: 'OK',
        whatsapp_connected: runtime.connectionStatus === 'open',
        connection_status: runtime.connectionStatus,
        connected_number: runtime.connectedNumber,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        auth_required: true
    })
})

app.post('/api/auth/login', (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1').get(username)
    if (!user || !crypto.timingSafeEqual(
        Buffer.from(hashPassword(password, user.password_salt).passwordHash, 'hex'),
        Buffer.from(user.password_hash, 'hex')
    )) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' })
    }
    const business = user.business_id
        ? db.prepare('SELECT id, name, phone, email, address, notes, is_active FROM businesses WHERE id = ?').get(user.business_id)
        : null
    if (user.business_id && !business?.is_active) return res.status(403).json({ success: false, error: 'This business is inactive' })
    const session = createAuthSession(user.id, user.business_id)
    setSessionCookie(req, res, session.token)
    auditEvent({ auth: { userId: user.id, businessId: user.business_id } }, 'login')
    res.json({
        success: true,
        user: { id: user.id, username: user.username, role: user.role, businessId: user.business_id, mustChangePassword: Boolean(user.must_change_password), impersonating: false },
        business: business ? { id: business.id, name: business.name, phone: business.phone, email: business.email, address: business.address, notes: business.notes } : null
    })
})

app.use('/api', authenticateApiKey)

app.post('/api/auth/logout', (req, res) => {
    if (req.auth?.sessionHash) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(req.auth.sessionHash)
    clearSessionCookie(req, res)
    res.json({ success: true })
})

app.get('/api/auth/me', (req, res) => {
    const business = req.auth.businessId
        ? db.prepare('SELECT id, name, phone, email, address, notes FROM businesses WHERE id = ?').get(req.auth.businessId)
        : null
    res.json({
        success: true,
        user: {
            id: req.auth.userId,
            username: req.auth.username,
            role: req.auth.role,
            businessId: req.auth.businessId,
            mustChangePassword: req.auth.mustChangePassword,
            impersonating: Boolean(req.auth.impersonatedBy)
        },
        business
    })
})

app.post('/api/auth/change-password', (req, res) => {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
    if (newPassword.length < 12) return res.status(400).json({ success: false, error: 'New password must be at least 12 characters' })
    const user = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(req.auth.userId)
    const candidate = Buffer.from(hashPassword(currentPassword, user.password_salt).passwordHash, 'hex')
    if (!crypto.timingSafeEqual(candidate, Buffer.from(user.password_hash, 'hex'))) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' })
    }
    const next = hashPassword(newPassword)
    db.prepare(`
        UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(next.passwordHash, next.salt, req.auth.userId)
    auditEvent(req, 'password_changed')
    res.json({ success: true })
})

app.post('/api/auth/change-username', (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email-style username' })
    }
    const user = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(req.auth.userId)
    const candidate = Buffer.from(hashPassword(password, user.password_salt).passwordHash, 'hex')
    if (!crypto.timingSafeEqual(candidate, Buffer.from(user.password_hash, 'hex'))) {
        return res.status(401).json({ success: false, error: 'Password is incorrect' })
    }
    try {
        db.prepare('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, req.auth.userId)
        auditEvent(req, 'username_changed', req.auth.businessId, { username })
        res.json({ success: true, username })
    } catch (error) {
        const status = error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500
        res.status(status).json({ success: false, error: status === 409 ? 'Username is already in use' : 'Failed to update username' })
    }
})

app.post('/api/auth/stop-impersonation', requireSuperadmin, (req, res) => {
    if (!req.auth.impersonatedBy) {
        return res.status(400).json({ success: false, error: 'This session is not impersonating a business' })
    }
    const parent = db.prepare(`
        SELECT s.user_id, u.role FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(req.auth.impersonatedBy, Date.now())
    if (!parent || parent.role !== 'superadmin') {
        return res.status(401).json({ success: false, error: 'Admin session expired; sign in again' })
    }
    const session = createAuthSession(parent.user_id)
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(req.auth.sessionHash)
    setSessionCookie(req, res, session.token)
    auditEvent(req, 'impersonation_ended', req.auth.businessId)
    res.json({ success: true })
})

// Protected endpoints (auth required)
app.use('/api/admin', requireSuperadmin)

function createBusinessApiKey(businessId, label = 'Default key') {
    const key = `wa_${crypto.randomBytes(24).toString('hex')}`
    const id = crypto.randomUUID()
    db.prepare(`
        INSERT INTO business_api_keys (id, business_id, key_hash, key_prefix, label)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, businessId, hashSecret(key), key.slice(0, 10), label)
    return { id, key }
}

app.get('/api/admin/businesses', (req, res) => {
    const businesses = db.prepare(`
        SELECT b.id, b.name, b.phone, b.email, b.address, b.notes, b.is_active, b.created_at,
            (SELECT username FROM users u WHERE u.business_id = b.id AND u.role = 'business' ORDER BY created_at LIMIT 1) AS username,
            (SELECT COUNT(*) FROM business_api_keys k WHERE k.business_id = b.id AND k.revoked_at IS NULL) AS api_key_count
        FROM businesses b ORDER BY b.created_at DESC
    `).all()
    res.json({ success: true, businesses })
})

app.post('/api/admin/businesses', (req, res) => {
    const { name, phone = null, email = null, address = null, notes = null, username, password } = req.body || {}
    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : ''
    if (typeof name !== 'string' || !name.trim() || !normalizedUsername || typeof password !== 'string' || password.length < 12) {
        return res.status(400).json({ success: false, error: 'Business name, username, and a password of at least 12 characters are required' })
    }
    const businessId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const passwordRecord = hashPassword(password)
    const create = db.transaction(() => {
        db.prepare(`
            INSERT INTO businesses (id, name, phone, email, address, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(businessId, name.trim(), phone, email, address, notes)
        db.prepare(`
            INSERT INTO users (id, business_id, username, password_hash, password_salt, role)
            VALUES (?, ?, ?, ?, ?, 'business')
        `).run(userId, businessId, normalizedUsername, passwordRecord.passwordHash, passwordRecord.salt)
        initializeAutoReplies(businessId)
        return createBusinessApiKey(businessId)
    })
    try {
        const apiKey = create()
        auditEvent(req, 'business_created', businessId, { name: name.trim(), username: normalizedUsername })
        res.status(201).json({ success: true, business: { id: businessId, name: name.trim(), username: normalizedUsername }, apiKey: apiKey.key })
    } catch (error) {
        const status = error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500
        res.status(status).json({ success: false, error: status === 409 ? 'Username already exists' : 'Failed to create business' })
    }
})

app.put('/api/admin/businesses/:businessId', (req, res) => {
    const { businessId } = req.params
    const current = db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId)
    if (!current) return res.status(404).json({ success: false, error: 'Business not found' })
    const { name, phone, email, address, notes, is_active } = req.body || {}
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ success: false, error: 'Business name is required' })
    db.prepare(`
        UPDATE businesses SET name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(name.trim(), phone || null, email || null, address || null, notes || null, is_active === false ? 0 : 1, businessId)
    auditEvent(req, 'business_updated', businessId, { name: name.trim() })
    res.json({ success: true })
})

app.put('/api/admin/businesses/:businessId/credentials', (req, res) => {
    const { businessId } = req.params
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
    const password = req.body?.password
    if (!username) return res.status(400).json({ success: false, error: 'Username is required' })
    if (password !== undefined && (typeof password !== 'string' || password.length < 12)) {
        return res.status(400).json({ success: false, error: 'Password must be at least 12 characters' })
    }
    const user = db.prepare("SELECT id FROM users WHERE business_id = ? AND role = 'business' ORDER BY created_at LIMIT 1").get(businessId)
    if (!user) return res.status(404).json({ success: false, error: 'Business user not found' })
    try {
        if (password) {
            const record = hashPassword(password)
            db.prepare(`UPDATE users SET username = ?, password_hash = ?, password_salt = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                .run(username, record.passwordHash, record.salt, user.id)
        } else {
            db.prepare('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, user.id)
        }
        auditEvent(req, 'business_credentials_updated', businessId, { username })
        res.json({ success: true })
    } catch (error) {
        const status = error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500
        res.status(status).json({ success: false, error: status === 409 ? 'Username already exists' : 'Failed to update credentials' })
    }
})

app.post('/api/admin/businesses/:businessId/api-keys', (req, res) => {
    const business = db.prepare('SELECT id FROM businesses WHERE id = ?').get(req.params.businessId)
    if (!business) return res.status(404).json({ success: false, error: 'Business not found' })
    const key = createBusinessApiKey(business.id, typeof req.body?.label === 'string' ? req.body.label.slice(0, 80) : 'Admin-issued key')
    auditEvent(req, 'business_api_key_created', business.id, { keyId: key.id })
    res.status(201).json({ success: true, apiKey: key.key })
})

app.post('/api/admin/businesses/:businessId/impersonate', (req, res) => {
    const business = db.prepare('SELECT id, name, is_active FROM businesses WHERE id = ?').get(req.params.businessId)
    if (!business || !business.is_active) return res.status(404).json({ success: false, error: 'Active business not found' })
    const session = createAuthSession(req.auth.userId, business.id, req.auth.sessionHash)
    setSessionCookie(req, res, session.token)
    auditEvent(req, 'impersonation_started', business.id, { businessName: business.name })
    res.json({ success: true, business: { id: business.id, name: business.name } })
})

app.get('/api/business/api-keys', (req, res) => {
    const apiKeys = db.prepare(`
        SELECT id, key_prefix, label, created_at, last_used_at FROM business_api_keys
        WHERE business_id = ? AND revoked_at IS NULL ORDER BY created_at DESC
    `).all(req.auth.businessId)
    res.json({ success: true, apiKeys })
})

app.post('/api/business/api-keys', (req, res) => {
    const key = createBusinessApiKey(req.auth.businessId, typeof req.body?.label === 'string' ? req.body.label.slice(0, 80) : 'External integration')
    auditEvent(req, 'business_api_key_created', req.auth.businessId, { keyId: key.id })
    res.status(201).json({ success: true, apiKey: key.key })
})

app.delete('/api/business/api-keys/:keyId', (req, res) => {
    const result = db.prepare(`
        UPDATE business_api_keys SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND business_id = ? AND revoked_at IS NULL
    `).run(req.params.keyId, req.auth.businessId)
    if (!result.changes) return res.status(404).json({ success: false, error: 'API key not found' })
    auditEvent(req, 'business_api_key_revoked', req.auth.businessId, { keyId: req.params.keyId })
    res.json({ success: true })
})

// Get detailed connection status
app.get('/api/status', (req, res) => {
    const businessId = req.auth.businessId
    const runtime = getBusinessRuntime(businessId)
    addLog('api', 'Status requested', {}, businessId)
    
    const totalLogs = countLogs.get(businessId).total
    const stats = getLogStats.all(businessId)
    const logsByType = {}
    stats.forEach(s => { logsByType[s.type] = s.count })
    
    res.json({
        success: true,
        connection: {
            status: runtime.connectionStatus,
            connected: runtime.connectionStatus === 'open',
            number: runtime.connectedNumber,
            registered: runtime.sock?.authState?.creds?.registered || false,
            error: runtime.connectionError
        },
        stats: {
            logs_count: totalLogs,
            logs_by_type: logsByType,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            database: 'SQLite'
        }
    })
})

app.post('/api/resolve-jids', async (req, res) => {
    const runtime = getBusinessRuntime(req.auth.businessId)
    const jids = Array.isArray(req.body?.jids)
        ? [...new Set(req.body.jids.filter(jid => typeof jid === 'string' && jid.endsWith('@lid')))]
        : []

    if (jids.length > 100) {
        return res.status(400).json({ success: false, error: 'Resolve at most 100 contacts at a time' })
    }

    try {
        const lidMapping = runtime.sock?.signalRepository?.lidMapping
        const resolved = lidMapping && jids.length
            ? await lidMapping.getPNsForLIDs(jids)
            : []
        const mappings = Object.fromEntries((resolved || []).map(({ lid, pn }) => [lid, pn]))
        res.json({ success: true, mappings })
    } catch (error) {
        addLog('error', `Error resolving contact numbers: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({ success: false, error: 'Failed to resolve contact numbers' })
    }
})

// Get logs with pagination and filtering
app.get('/api/logs', (req, res) => {
    const { limit = 100, type, since, offset = 0 } = req.query
    const limitNum = Math.min(parseInt(limit) || 100, 1000)
    const offsetNum = Math.max(parseInt(offset) || 0, 0)
    const businessId = req.auth.businessId
    
    let logs = []
    let total = 0
    
    try {
        if (type && since) {
            logs = getLogsByTypeAndSince.all(businessId, type, since, limitNum, offsetNum)
            total = countLogsByType.get(businessId, type).total
        } else if (type) {
            logs = getLogsByType.all(businessId, type, limitNum, offsetNum)
            total = countLogsByType.get(businessId, type).total
        } else if (since) {
            logs = getLogsSince.all(businessId, since, limitNum, offsetNum)
            total = countLogs.get(businessId).total
        } else {
            logs = getLogs.all(businessId, limitNum, offsetNum)
            total = countLogs.get(businessId).total
        }
        
        // Parse details JSON for each log
        logs = logs.map(log => ({
            ...log,
            details: JSON.parse(log.details || '{}')
        }))
        
        res.json({
            success: true,
            logs,
            total,
            limit: limitNum,
            database: 'SQLite'
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        })
    }
})

// Get log statistics
app.get('/api/logs/stats', (req, res) => {
    try {
        const total = countLogs.get(req.auth.businessId).total
        const byType = getLogStats.all(req.auth.businessId)
        const stats = {}
        byType.forEach(s => { stats[s.type] = s.count })
        
        res.json({
            success: true,
            total,
            by_type: stats
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        })
    }
})

// Clear logs
app.delete('/api/logs', (req, res) => {
    try {
        clearAllLogs.run(req.auth.businessId)
        addLog('info', 'All logs cleared', {}, req.auth.businessId)
        res.json({ success: true, message: 'Logs cleared' })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        })
    }
})

// Request pairing code for new number
app.post('/api/request-pairing', async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        const { phoneNumber } = req.body

        if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            })
        }

        // Format phone number (remove + and non-digits)
        const formattedNumber = phoneNumber.replace(/\D/g, '')
        if (formattedNumber.length < 8 || formattedNumber.length > 15) {
            return res.status(400).json({
                success: false,
                error: 'Enter a valid phone number with country code'
            })
        }

        addLog('api', `Requesting pairing code for: ${formattedNumber}`, {}, businessId)

        // A registered session cannot be used to pair a different number.
        if (runtime.sock?.authState.creds.registered) {
            return res.status(409).json({
                success: false,
                error: 'An account is already linked. Disconnect and reset the session before pairing a new number.'
            })
        }

        // If no socket exists, initialize WhatsApp first
        if (!runtime.sock) {
            addLog('connection', 'Initializing WhatsApp for pairing...', {}, businessId)
            await initWhatsAppForPairing(businessId)
            
            // Wait for socket to be ready
            let attempts = 0
            while (!runtime.sock && attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 500))
                attempts++
            }
            
            if (!runtime.sock) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to initialize WhatsApp connection'
                })
            }
        }

        const pairingSocket = runtime.sock
        await pairingSocket.waitForSocketOpen()
        if (pairingSocket !== runtime.sock) {
            throw new Error('WhatsApp connection changed while preparing the pairing code. Please try again.')
        }

        const pairingCode = await pairingSocket.requestPairingCode(formattedNumber)

        addLog('connection', `Pairing code generated: ${pairingCode}`, { phoneNumber: formattedNumber }, businessId)

        res.json({
            success: true,
            pairingCode: pairingCode,
            phoneNumber: formattedNumber
        })

    } catch (error) {
        addLog('error', `Error requesting pairing code: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to request pairing code'
        })
    }
})

app.post('/api/request-qr', async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        if (runtime.sock?.authState.creds.registered || runtime.connectionStatus === 'open') {
            return res.status(409).json({
                success: false,
                error: 'An account is already linked. Disconnect and reset the session before pairing a new number.'
            })
        }

        if (runtime.sock) {
            const previousSocket = runtime.sock
            runtime.sock = null
            previousSocket.end()
        }

        runtime.pairingQr = null
        runtime.connectionError = null
        await initWhatsAppForPairing(businessId)
        res.json({ success: true })
    } catch (error) {
        addLog('error', `Error starting QR pairing: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({ success: false, error: error.message || 'Failed to start QR pairing' })
    }
})

app.get('/api/pairing-qr', async (req, res) => {
    try {
        const runtime = getBusinessRuntime(req.auth.businessId)
        const qrCode = runtime.pairingQr
            ? await QRCode.toDataURL(runtime.pairingQr, { width: 280, margin: 1 })
            : null

        res.json({
            success: true,
            qrCode,
            connectionStatus: runtime.connectionStatus,
            connected: runtime.connectionStatus === 'open',
            error: runtime.connectionError
        })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to render QR code' })
    }
})

// Disconnect current session
app.post('/api/disconnect', async (req, res) => {
    try {
        const runtime = getBusinessRuntime(req.auth.businessId)
        if (runtime.sock) {
            addLog('connection', 'Disconnecting WhatsApp session', {}, req.auth.businessId)
            await runtime.sock.logout()
            runtime.sock = null
            runtime.connectionStatus = 'disconnected'
            runtime.connectedNumber = null
            res.json({ success: true, message: 'Disconnected successfully' })
        } else {
            res.json({ success: false, error: 'No active connection' })
        }
    } catch (error) {
        addLog('error', `Error disconnecting: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({ success: false, error: error.message })
    }
})

// Reconnect
app.post('/api/reconnect', async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        addLog('connection', 'Reconnection requested', {}, businessId)
        if (runtime.sock) {
            runtime.sock.end()
            runtime.sock = null
        }
        runtime.connectionStatus = 'connecting'
        void connectToWhatsApp(businessId)
        res.json({ success: true, message: 'Reconnection initiated' })
    } catch (error) {
        addLog('error', `Error reconnecting: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({ success: false, error: error.message })
    }
})

// Reset auth (clear session files)
app.post('/api/reset-auth', async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        addLog('connection', 'Auth reset requested', {}, businessId)
        
        // Disconnect first
        if (runtime.sock) {
            try {
            await runtime.sock.logout()
            } catch (e) {
                // Ignore logout errors
            }
            runtime.sock = null
        }
        
        runtime.connectionStatus = 'disconnected'
        runtime.connectedNumber = null
        
        // Delete auth folder
        const authFolder = authDirectoryForBusiness(businessId)
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true })
            addLog('info', 'Auth folder deleted', {}, businessId)
        }
        
        res.json({ success: true, message: 'Auth reset. Restart the bot to connect a new number.' })
    } catch (error) {
        addLog('error', `Error resetting auth: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({ success: false, error: error.message })
    }
})

// Send text message
app.post('/api/send-message', async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        const { phoneNumber, message } = req.body

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and message are required'
            })
        }

        if (!runtime.sock || runtime.connectionStatus !== 'open') {
            return res.status(500).json({
                success: false,
                error: 'WhatsApp not connected'
            })
        }

        // Format phone number (remove + and ensure it has @s.whatsapp.net)
        let formattedNumber = phoneNumber.replace(/\D/g, '') // Remove non-digits
        if (!formattedNumber.includes('@s.whatsapp.net')) {
            formattedNumber = `${formattedNumber}@s.whatsapp.net`
        }

        // Send message
        const result = await runtime.sock.sendMessage(formattedNumber, { text: message })

        addLog('message_out', `Message sent to ${phoneNumber}`, { 
            to: formattedNumber, 
            messageId: result?.key?.id,
            preview: message.substring(0, 50),
            content: message
        }, businessId)

        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: result?.key?.id,
            to: formattedNumber
        })

    } catch (error) {
        addLog('error', `Error sending message: ${error.message}`, {}, req.auth.businessId)
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Send file (supports images, documents, videos, audio, etc.)
app.post('/api/send-file', upload.single('file'), async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        const { phoneNumber, caption } = req.body
        const uploadedFile = req.file

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            })
        }

        if (!uploadedFile) {
            return res.status(400).json({
                success: false,
                error: 'File is required'
            })
        }

        if (!runtime.sock || runtime.connectionStatus !== 'open') {
            return res.status(500).json({
                success: false,
                error: 'WhatsApp not connected'
            })
        }

        // Format phone number
        let formattedNumber = phoneNumber.replace(/\D/g, '')
        if (!formattedNumber.includes('@s.whatsapp.net')) {
            formattedNumber = `${formattedNumber}@s.whatsapp.net`
        }

        // Read file
        const fileBuffer = fs.readFileSync(uploadedFile.path)
        const fileName = uploadedFile.originalname
        const mimeType = uploadedFile.mimetype

        // Determine message type based on MIME type
        let messageData = {}
        let fileType = 'document'

        if (mimeType.startsWith('image/')) {
            // Images
            messageData = {
                image: fileBuffer,
                caption: caption || '',
                mimetype: mimeType
            }
            fileType = 'image'
        } else if (mimeType.startsWith('video/')) {
            // Videos
            messageData = {
                video: fileBuffer,
                caption: caption || '',
                mimetype: mimeType
            }
            fileType = 'video'
        } else if (mimeType.startsWith('audio/')) {
            // Audio files
            messageData = {
                audio: fileBuffer,
                mimetype: mimeType
            }
            fileType = 'audio'
        } else {
            // Documents (PDF, DOC, TXT, etc.)
            messageData = {
                document: fileBuffer,
                mimetype: mimeType,
                fileName: fileName,
                caption: caption || ''
            }
            fileType = 'document'
        }

        // Send file
        const result = await runtime.sock.sendMessage(formattedNumber, messageData)

        // Clean up uploaded file
        fs.unlinkSync(uploadedFile.path)

        addLog('message_out', `${fileType} sent to ${phoneNumber}`, {
            to: formattedNumber,
            messageId: result?.key?.id,
            fileName: fileName,
            fileType: fileType,
            mimeType: mimeType,
            caption: caption || '(no caption)'
        }, businessId)

        res.json({
            success: true,
            message: `${fileType} sent successfully`,
            messageId: result?.key?.id,
            to: formattedNumber,
            fileType: fileType,
            fileName: fileName
        })

    } catch (error) {
        addLog('error', `Error sending file: ${error.message}`, {}, req.auth.businessId)

        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path)
        }

        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Keep the old send-image endpoint for backward compatibility
app.post('/api/send-image', upload.single('image'), async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const runtime = getBusinessRuntime(businessId)
        const { phoneNumber, caption } = req.body
        const imageFile = req.file

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            })
        }

        if (!imageFile) {
            return res.status(400).json({
                success: false,
                error: 'Image file is required'
            })
        }

        if (!runtime.sock || runtime.connectionStatus !== 'open') {
            return res.status(500).json({
                success: false,
                error: 'WhatsApp not connected'
            })
        }

        // Format phone number
        let formattedNumber = phoneNumber.replace(/\D/g, '')
        if (!formattedNumber.includes('@s.whatsapp.net')) {
            formattedNumber = `${formattedNumber}@s.whatsapp.net`
        }

        // Read image file
        const imageBuffer = fs.readFileSync(imageFile.path)

        // Send image
        const result = await runtime.sock.sendMessage(formattedNumber, {
            image: imageBuffer,
            caption: caption || ''
        })

        // Clean up uploaded file
        fs.unlinkSync(imageFile.path)

        addLog('message_out', `Image sent to ${phoneNumber}`, {
            to: formattedNumber,
            messageId: result?.key?.id,
            caption: caption || '(no caption)'
        }, businessId)

        res.json({
            success: true,
            message: 'Image sent successfully',
            messageId: result?.key?.id,
            to: formattedNumber
        })

    } catch (error) {
        addLog('error', `Error sending image: ${error.message}`, {}, req.auth.businessId)

        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path)
        }

        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// API Key Management endpoints
app.get('/api/apikey', (req, res) => {
    const keys = db.prepare(`
        SELECT id, key_prefix, label, created_at, last_used_at FROM business_api_keys
        WHERE business_id = ? AND revoked_at IS NULL ORDER BY created_at DESC
    `).all(req.auth.businessId)
    res.json({
        success: true,
        api_keys: keys
    })
})

app.post('/api/apikey/regenerate', (req, res) => {
    db.prepare(`UPDATE business_api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND revoked_at IS NULL`)
        .run(req.auth.businessId)
    const generated = createBusinessApiKey(req.auth.businessId, 'Regenerated key')
    addLog('info', 'Business API key regenerated', { keyId: generated.id }, req.auth.businessId)
    res.json({
        success: true,
        api_key: generated.key,
        message: 'New business API key created. Copy it now; it will not be shown again.'
    })
})

// Auto-Reply Management endpoints
app.get('/api/auto-replies', (req, res) => {
    try {
        const getReplies = db.prepare('SELECT id, trigger_word, reply_message, is_active, created_at, updated_at FROM auto_replies WHERE business_id = ? ORDER BY created_at DESC')
        const replies = getReplies.all(req.auth.businessId)
        res.json({
            success: true,
            auto_replies: replies
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

app.post('/api/auto-replies', (req, res) => {
    try {
        const { trigger_word, reply_message } = req.body

        if (!trigger_word || !reply_message) {
            return res.status(400).json({
                success: false,
                error: 'Both trigger_word and reply_message are required'
            })
        }

        const insertReply = db.prepare('INSERT INTO auto_replies (business_id, trigger_word, reply_message) VALUES (?, ?, ?)')
        const result = insertReply.run(req.auth.businessId, trigger_word, reply_message)

        addLog('info', `Auto-reply rule added: "${trigger_word}"`, {}, req.auth.businessId)

        res.json({
            success: true,
            message: 'Auto-reply rule added successfully',
            id: result.lastInsertRowid
        })
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({
                success: false,
                error: 'Trigger word already exists'
            })
        } else {
            res.status(500).json({
                success: false,
                error: error.message
            })
        }
    }
})

app.delete('/api/auto-replies/:id', (req, res) => {
    try {
        const { id } = req.params
        const deleteReply = db.prepare('DELETE FROM auto_replies WHERE id = ? AND business_id = ?')
        const result = deleteReply.run(id, req.auth.businessId)

        if (result.changes > 0) {
            addLog('info', `Auto-reply rule deleted: ID ${id}`, {}, req.auth.businessId)
            res.json({
                success: true,
                message: 'Auto-reply rule deleted successfully'
            })
        } else {
            res.status(404).json({
                success: false,
                error: 'Auto-reply rule not found'
            })
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

app.put('/api/auto-replies/:id/toggle', (req, res) => {
    try {
        const { id } = req.params
        const toggleReply = db.prepare('UPDATE auto_replies SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?')
        const result = toggleReply.run(id, req.auth.businessId)

        if (result.changes > 0) {
            addLog('info', `Auto-reply rule toggled: ID ${id}`, {}, req.auth.businessId)
            res.json({
                success: true,
                message: 'Auto-reply rule status updated'
            })
        } else {
            res.status(404).json({
                success: false,
                error: 'Auto-reply rule not found'
            })
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// PDF Compression endpoints
app.post('/api/compress-pdf', upload.single('pdf'), async (req, res) => {
    try {
        const businessId = req.auth.businessId
        const { webhookUrl } = req.body
        const pdfFile = req.file

        if (!webhookUrl) {
            return res.status(400).json({
                success: false,
                error: 'webhookUrl is required'
            })
        }

        if (!pdfFile) {
            return res.status(400).json({
                success: false,
                error: 'PDF file is required'
            })
        }

        // Validate it's a PDF
        if (pdfFile.mimetype !== 'application/pdf') {
            // Clean up uploaded file
            fs.unlinkSync(pdfFile.path)
            return res.status(400).json({
                success: false,
                error: 'Only PDF files are allowed'
            })
        }

        // Generate unique job ID
        const jobId = crypto.randomBytes(16).toString('hex')

        // Insert job record
        const insertJob = db.prepare(`
            INSERT INTO pdf_compression_jobs (business_id, job_id, webhook_url, original_filename, original_size, status)
            VALUES (?, ?, ?, ?, ?, 'processing')
        `)
        insertJob.run(businessId, jobId, webhookUrl, pdfFile.originalname, pdfFile.size)

        // Start compression asynchronously
        compressPdfAsync(jobId, pdfFile.path, pdfFile.originalname, businessId)

        addLog('info', `PDF compression job started: ${jobId}`, {}, businessId)

        res.json({
            success: true,
            jobId: jobId,
            message: 'PDF compression started. Results will be sent to webhook.',
            status: 'processing'
        })

    } catch (error) {
        addLog('error', `Error starting PDF compression: ${error.message}`, {}, businessId)

        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path)
        }

        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Get compression job status
app.get('/api/compress-pdf/:jobId', (req, res) => {
    try {
        const { jobId } = req.params
        const getJob = db.prepare('SELECT * FROM pdf_compression_jobs WHERE job_id = ? AND business_id = ?')
        const job = getJob.get(jobId, req.auth.businessId)

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            })
        }

        res.json({
            success: true,
            job: {
                id: job.id,
                jobId: job.job_id,
                status: job.status,
                originalFilename: job.original_filename,
                compressedFilename: job.compressed_filename,
                originalSize: job.original_size,
                compressedSize: job.compressed_size,
                compressionRatio: job.compression_ratio,
                createdAt: job.created_at,
                completedAt: job.completed_at,
                errorMessage: job.error_message
            }
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
})

// Legacy endpoints (redirect to /api/ with auth) - for backward compatibility
// These will require API key now
app.get('/status', authenticateApiKey, (req, res) => res.redirect(307, '/api/status'))
app.get('/logs', authenticateApiKey, (req, res) => res.redirect(307, '/api/logs'))
app.get('/logs/stats', authenticateApiKey, (req, res) => res.redirect(307, '/api/logs/stats'))
app.delete('/logs', authenticateApiKey, (req, res) => res.redirect(307, '/api/logs'))
app.post('/request-pairing', authenticateApiKey, (req, res) => res.redirect(307, '/api/request-pairing'))
app.post('/disconnect', authenticateApiKey, (req, res) => res.redirect(307, '/api/disconnect'))
app.post('/reconnect', authenticateApiKey, (req, res) => res.redirect(307, '/api/reconnect'))
app.post('/reset-auth', authenticateApiKey, (req, res) => res.redirect(307, '/api/reset-auth'))
app.post('/send-message', authenticateApiKey, (req, res) => res.redirect(307, '/api/send-message'))
app.post('/send-image', authenticateApiKey, (req, res) => res.redirect(307, '/api/send-image'))

// Serve static dashboard files (production)
const dashboardPath = path.join(__dirname, 'dashboard', 'dist')
if (fs.existsSync(dashboardPath)) {
    app.use(express.static(dashboardPath))
    
    // SPA catch-all route - serve index.html for any non-API routes
    app.get('/{*splat}', (req, res) => {
        // Don't catch API routes
        if (req.path.startsWith('/api') || req.path === '/health') {
            return res.status(404).json({ error: 'Not found' })
        }
        res.sendFile(path.join(dashboardPath, 'index.html'))
    })
    
    console.log('🌐 Dashboard served from /dashboard/dist')
}

// Start API Server
app.listen(PORT, () => {
    addLog('info', `API Server running on port ${PORT}`)
    console.log(`🚀 API Server running on port ${PORT}`)
    console.log(`📡 Health check: http://localhost:${PORT}/health`)
    console.log(`📊 Dashboard API ready`)
    console.log(`💾 Logs stored in SQLite database: logs.db`)
    console.log('🔐 Business API keys are managed in the authenticated dashboard.')
})

// Initialize WhatsApp for pairing (without auto-requesting code)
function attachWhatsAppHandlers(sock, state, saveCreds, businessId) {
    const runtime = getBusinessRuntime(businessId)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (update.qr) {
            runtime.pairingQr = update.qr
            addLog('connection', 'WhatsApp QR challenge received', {}, businessId)
        }

        if (connection === 'close') {
            if (runtime.sock !== sock) return
            const qrReceived = Boolean(runtime.pairingQr)
            runtime.connectionStatus = 'disconnected'
            runtime.pairingQr = null
            const disconnectCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = disconnectCode !== DisconnectReason.loggedOut && (
                state.creds.registered || [
                    DisconnectReason.restartRequired,
                    DisconnectReason.connectionClosed,
                    DisconnectReason.connectionLost,
                    DisconnectReason.timedOut
                ].includes(disconnectCode)
            )
            runtime.connectionError = shouldReconnect ? null : (lastDisconnect?.error?.message || 'WhatsApp connection closed')
            addLog('error', `WhatsApp connection closed (${disconnectCode ?? 'unknown'}): ${runtime.connectionError}`, { qrReceived }, businessId)

            if (shouldReconnect) {
                addLog('connection', 'Connection closed, reconnecting...', {}, businessId)
                runtime.sock = null
                runtime.connectionStatus = 'connecting'
                setTimeout(() => {
                    if (!runtime.sock) void connectToWhatsApp(businessId)
                }, 5000)
            } else {
                addLog('connection', disconnectCode === DisconnectReason.loggedOut ? 'Connection logged out' : 'Connection closed; automatic retry skipped', {}, businessId)
                runtime.sock = null
            }
        } else if (connection === 'connecting') {
            runtime.connectionStatus = 'connecting'
            runtime.connectionError = null
            addLog('connection', 'Connecting to WhatsApp...', {}, businessId)
        } else if (connection === 'open') {
            runtime.connectionStatus = 'open'
            runtime.pairingQr = null
            runtime.connectionError = null
            runtime.connectedNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || null
            addLog('connection', `WhatsApp connected! Number: ${runtime.connectedNumber}`, {}, businessId)
            console.log(`✅ WhatsApp connected for ${businessId}`)
        }
    })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue

            const sender = msg.key.remoteJid
            const messageType = Object.keys(msg.message)[0]
            let messageContent = ''
            if (messageType === 'conversation') {
                messageContent = msg.message.conversation
            } else if (messageType === 'extendedTextMessage') {
                messageContent = msg.message.extendedTextMessage.text
            } else if (messageType === 'imageMessage') {
                messageContent = msg.message.imageMessage.caption || '[Image]'
            }

            addLog('message_in', `Message from ${sender}: ${messageContent}`, {
                from: sender,
                type: messageType,
                content: messageContent
            }, businessId)

            const replies = db.prepare(`
                SELECT trigger_word, reply_message FROM auto_replies
                WHERE business_id = ? AND is_active = 1
            `).all(businessId)
            const match = replies.find(reply => messageContent.toLowerCase().includes(reply.trigger_word.toLowerCase()))
            if (match) {
                await sock.sendMessage(sender, { text: match.reply_message })
                addLog('message_out', `Auto-replied: ${match.reply_message}`, {
                    to: sender,
                    trigger: match.trigger_word,
                    content: match.reply_message
                }, businessId)
            }
        }
    })
}

async function initWhatsAppForPairing(businessId = DEFAULT_BUSINESS_ID) {
    const runtime = getBusinessRuntime(businessId)
    const authDirectory = authDirectoryForBusiness(businessId)
    fs.mkdirSync(authDirectory, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory)
    await clearIncompletePairingState(state, saveCreds)

    // Create WhatsApp socket
    const sock = makeWASocket({
        auth: state,
        browser: Browsers.ubuntu('Baileys Dashboard'),
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' })
    })

    runtime.sock = sock
    runtime.connectionStatus = 'connecting'
    attachWhatsAppHandlers(sock, state, saveCreds, businessId)
    return sock
}

async function connectToWhatsApp(businessId = DEFAULT_BUSINESS_ID) {
    const runtime = getBusinessRuntime(businessId)
    const authDirectory = authDirectoryForBusiness(businessId)
    fs.mkdirSync(authDirectory, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory)

    // Create WhatsApp socket
    const sock = makeWASocket({
        auth: state,
        browser: Browsers.ubuntu('Baileys Dashboard'),
        printQRInTerminal: false, // Disable QR for pairing code
        logger: require('pino')({ level: 'silent' })
    })

    if (!state.creds.registered && !hasPendingQrLogin(state.creds)) {
        addLog('connection', 'WhatsApp is not paired for this business; request a QR code to connect.', {}, businessId)
    }
    runtime.sock = sock
    runtime.connectionStatus = 'connecting'
    attachWhatsAppHandlers(sock, state, saveCreds, businessId)
    return sock
}

async function clearIncompletePairingState(state, saveCreds) {
    if (state.creds.registered || hasPendingQrLogin(state.creds)) return

    delete state.creds.me
    delete state.creds.pairingCode
    await saveCreds()
}

function hasPendingQrLogin(creds) {
    return Boolean(!creds.registered && creds.me?.id && creds.me?.name && creds.me.name !== '~')
}

// Start the bot - check if there's existing auth first
async function startBot() {
    const businesses = db.prepare('SELECT id, name FROM businesses WHERE is_active = 1').all()
    for (const business of businesses) {
        const authDirectory = authDirectoryForBusiness(business.id)
        const credsFile = path.join(authDirectory, 'creds.json')
        if (!fs.existsSync(credsFile)) {
            addLog('connection', `No WhatsApp session for ${business.name}; waiting for pairing.`, {}, business.id)
            continue
        }
        try {
            const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'))
            if (creds.registered || hasPendingQrLogin(creds)) {
                addLog('connection', `Restoring WhatsApp session for ${business.name}.`, {}, business.id)
                await connectToWhatsApp(business.id)
            }
        } catch (error) {
            addLog('error', `Could not restore WhatsApp session for ${business.name}: ${error.message}`, {}, business.id)
        }
    }
}

startBot().catch(console.error)

// PDF Compression function
async function compressPdfAsync(jobId, inputPath, originalFilename, businessId = DEFAULT_BUSINESS_ID) {
    const outputFilename = `compressed_${Date.now()}_${originalFilename}`
    const outputPath = path.join('uploads', outputFilename)

    try {
        // Ghostscript command for PDF compression
        // -sDEVICE=pdfwrite: output as PDF
        // -dCompatibilityLevel=1.4: PDF version
        // -dPDFSETTINGS=/ebook: compression preset (can be /screen, /ebook, /prepress, /printer)
        // -dNOPAUSE -dQUIET -dBATCH: batch processing
        const gsCommand = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputPath} ${inputPath}`

        addLog('info', `Starting PDF compression for job ${jobId}`, {}, businessId)

        const { stdout, stderr } = await execAsync(gsCommand)

        // Check if output file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('Compressed PDF was not created')
        }

        // Get file sizes
        const originalStats = fs.statSync(inputPath)
        const compressedStats = fs.statSync(outputPath)

        const compressionRatio = ((originalStats.size - compressedStats.size) / originalStats.size * 100).toFixed(2)

        // Update job record
        const updateJob = db.prepare(`
            UPDATE pdf_compression_jobs
            SET status = 'completed',
                compressed_filename = ?,
                compressed_size = ?,
                compression_ratio = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
        `)
        updateJob.run(outputFilename, compressedStats.size, compressionRatio, jobId)

        // Clean up original file
        fs.unlinkSync(inputPath)

        // Send webhook
        const getJob = db.prepare('SELECT * FROM pdf_compression_jobs WHERE job_id = ?')
        const job = getJob.get(jobId)

        // Read compressed file and send in webhook
        const compressedFilePath = path.join('uploads', outputFilename)
        const compressedFileData = fs.readFileSync(compressedFilePath)
        const base64Data = compressedFileData.toString('base64')

        // Send webhook with file data directly
        const webhookPayload = {
            jobId: job.job_id,
            status: 'completed',
            originalFilename: job.original_filename,
            compressedFilename: outputFilename,
            originalSize: job.original_size,
            compressedSize: job.compressed_size,
            compressionRatio: parseFloat(job.compression_ratio),
            fileData: base64Data,
            mimeType: 'application/pdf',
            completedAt: job.completed_at
        }

        // Send webhook
        try {
            const webhookResponse = await fetch(job.webhook_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'WhatsApp-PDF-Compressor/1.0'
                },
                body: JSON.stringify(webhookPayload)
            })

            if (webhookResponse.ok) {
                addLog('info', `Webhook sent successfully for job ${jobId}`, {}, businessId)
            } else {
                addLog('error', `Webhook failed for job ${jobId}: ${webhookResponse.status}`, {}, businessId)
            }
        } catch (webhookError) {
            addLog('error', `Webhook error for job ${jobId}: ${webhookError.message}`, {}, businessId)
        }

        addLog('info', `PDF compression completed for job ${jobId}: ${compressionRatio}% reduction`, {}, businessId)

    } catch (error) {
        addLog('error', `PDF compression failed for job ${jobId}: ${error.message}`, {}, businessId)

        // Update job record with error
        const updateJobError = db.prepare(`
            UPDATE pdf_compression_jobs
            SET status = 'failed',
                error_message = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
        `)
        updateJobError.run(error.message, jobId)

        // Clean up files
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath)
        }
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath)
        }

        // Send error webhook
        try {
            const getJob = db.prepare('SELECT webhook_url FROM pdf_compression_jobs WHERE job_id = ?')
            const job = getJob.get(jobId)

            if (job) {
                const errorPayload = {
                    jobId: jobId,
                    status: 'failed',
                    error: error.message
                }

                await fetch(job.webhook_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'WhatsApp-PDF-Compressor/1.0'
                    },
                    body: JSON.stringify(errorPayload)
                })
            }
        } catch (webhookError) {
            addLog('error', `Error webhook failed for job ${jobId}: ${webhookError.message}`, {}, businessId)
        }
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    addLog('info', 'Shutting down gracefully...')
    console.log('Shutting down gracefully...')
    db.close()
    process.exit(0)
})

process.on('SIGTERM', () => {
    addLog('info', 'Received SIGTERM, shutting down...')
    db.close()
    process.exit(0)
})
