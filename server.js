'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const { Pool }   = require('pg');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Supabase clients ────────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://tfirfgiwgcagbwjeptbp.supabase.co';
const SUPABASE_ANON    = 'sb_publishable_L_F839UxiYH8yMlIgXmyBA_2D34OC8R';
const SUPABASE_SERVICE = 'sb_secret_NXqUGlJ06575Jf0T6HBimg_MYSYhcLo';

const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON);
const supabaseAdmin  = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ─── Postgres pool (Supabase connection string) ───────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : false
});

// ─── Admin password ───────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '3462Abel';
const WHATSAPP_NUM   = '260769341336';

// ─── Simple in-memory rate limiter ────────────────────────────────────────────
const _rl = {};
function rateLimit(key, max = 10, windowMs = 60000) {
  const now = Date.now();
  if (!_rl[key] || now > _rl[key].resetAt) _rl[key] = { count: 0, resetAt: now + windowMs };
  _rl[key].count++;
  return _rl[key].count > max;
}
setInterval(() => { const now = Date.now(); Object.keys(_rl).forEach(k => { if (now > _rl[k].resetAt) delete _rl[k]; }); }, 300000);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// ─── Multer (file uploads — in-memory or local /uploads) ─────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── DB: initialise tables ───────────────────────────────────────────────────
async function initDB () {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT,
        category_id   INT REFERENCES categories(id) ON DELETE SET NULL,
        price         NUMERIC(12,2) NOT NULL DEFAULT 0,
        prev_price    NUMERIC(12,2),
        save_amount   NUMERIC(12,2),
        discount      NUMERIC(12,2) DEFAULT 0,
        shipping_fee  NUMERIC(12,2) DEFAULT 0,
        stock         INT DEFAULT 0,
        sales_count   INT DEFAULT 0,
        badge         TEXT,
        show_badge    BOOLEAN DEFAULT TRUE,
        sort_position INT DEFAULT 50,
        specs         TEXT,
        how_to_use    TEXT,
        colors        TEXT,
        images_store  TEXT,
        images_carousel TEXT,
        images_detail TEXT,
        deal_ends_at  TIMESTAMPTZ,
        is_active     BOOLEAN DEFAULT TRUE,
        is_featured   BOOLEAN DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id         SERIAL PRIMARY KEY,
        product_id INT REFERENCES products(id) ON DELETE CASCADE,
        user_id    UUID,
        reviewer   TEXT NOT NULL,
        rating     INT CHECK (rating BETWEEN 1 AND 5),
        comment    TEXT,
        status     TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id               SERIAL PRIMARY KEY,
        order_number     TEXT NOT NULL UNIQUE,
        user_id          UUID,
        customer_name    TEXT NOT NULL,
        customer_phone   TEXT NOT NULL,
        customer_email   TEXT,
        customer_city    TEXT,
        customer_addr1   TEXT,
        customer_addr2   TEXT,
        remark           TEXT,
        products_json    TEXT NOT NULL,
        subtotal         NUMERIC(12,2) DEFAULT 0,
        discount         NUMERIC(12,2) DEFAULT 0,
        voucher_discount NUMERIC(12,2) DEFAULT 0,
        voucher_code     TEXT,
        shipping_fee     NUMERIC(12,2) DEFAULT 0,
        total            NUMERIC(12,2) DEFAULT 0,
        payment_method   TEXT DEFAULT 'pay_after',
        payment_status   TEXT DEFAULT 'pending',
        order_status     TEXT DEFAULT 'pending',
        tx_ref           TEXT,
        network          TEXT,
        stk_phone        TEXT,
        is_read          BOOLEAN DEFAULT FALSE,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        order_id   INT REFERENCES orders(id) ON DELETE CASCADE,
        message    TEXT,
        is_read    BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS recent_purchases (
        id          SERIAL PRIMARY KEY,
        name        TEXT,
        product     TEXT,
        location    TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        id            UUID PRIMARY KEY,
        email         TEXT,
        full_name     TEXT,
        phone         TEXT,
        country       TEXT DEFAULT 'Zambia',
        role          TEXT DEFAULT 'customer',
        is_disabled   BOOLEAN DEFAULT FALSE,
        referral_code TEXT UNIQUE,
        referred_by   TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cart_items (
        id         SERIAL PRIMARY KEY,
        user_id    UUID NOT NULL,
        product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity   INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS flash_sales (
        id           SERIAL PRIMARY KEY,
        title        TEXT NOT NULL,
        subtitle     TEXT,
        discount_pct INT DEFAULT 0,
        discount_amt NUMERIC(12,2) DEFAULT 0,
        badge_color  TEXT DEFAULT '#e3001b',
        starts_at    TIMESTAMPTZ DEFAULT NOW(),
        ends_at      TIMESTAMPTZ NOT NULL,
        product_ids  TEXT,
        is_active    BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vouchers (
        id             SERIAL PRIMARY KEY,
        code           TEXT NOT NULL UNIQUE,
        description    TEXT,
        discount_type  TEXT DEFAULT 'percent',
        discount_value NUMERIC(12,2) NOT NULL,
        min_order_amt  NUMERIC(12,2) DEFAULT 0,
        max_uses       INT DEFAULT 100,
        times_used     INT DEFAULT 0,
        valid_from     TIMESTAMPTZ DEFAULT NOW(),
        valid_until    TIMESTAMPTZ,
        is_active      BOOLEAN DEFAULT TRUE,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admin_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sales_registrations (
        id          SERIAL PRIMARY KEY,
        user_id     UUID,
        full_name   TEXT NOT NULL,
        email       TEXT NOT NULL,
        phone       TEXT NOT NULL,
        country     TEXT NOT NULL,
        city        TEXT,
        experience  TEXT,
        status      TEXT DEFAULT 'pending',
        reviewed_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // seed default admin settings if empty
    await client.query(`
      INSERT INTO admin_settings (key, value) VALUES
        ('country',             'Zambia'),
        ('currency_code',       'ZMW'),
        ('currency_symbol',     'K'),
        ('language',            'English'),
        ('store_name',          'Zmafrdeal'),
        ('whatsapp',            '260769341336'),
        ('featured_enabled',    'true'),
        ('flash_sales_enabled', 'true'),
        ('bundle_deal_enabled', 'false'),
        ('bundle_deal_text',    'Buy 2 items and get 10% OFF!'),
        ('bundle_deal_cta',     'Shop Now'),
        ('stock_threshold',     '5')
      ON CONFLICT (key) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS restock_alerts (
        id           SERIAL PRIMARY KEY,
        product_id   INT REFERENCES products(id) ON DELETE CASCADE,
        product_name TEXT,
        name         TEXT,
        contact      TEXT NOT NULL,
        notified_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_restock_product ON restock_alerts(product_id, notified_at);
    `);

    console.log('✅  DB ready');
  } finally {
    client.release();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const db     = (sql, params) => pool.query(sql, params);
const genNum = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

function ok  (res, data)  { res.json({ ok: true,  ...data }); }
function fail(res, msg, code = 400) { res.status(code).json({ ok: false, error: msg }); }

// ─── Auth middleware (Supabase JWT) ──────────────────────────────────────────
async function requireUser (req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return fail(res, 'Unauthorized — no token', 401);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return fail(res, 'Unauthorized — invalid token', 401);
  req.user = data.user;
  next();
}

// ─── Admin middleware (session password) ─────────────────────────────────────
function requireAdmin (req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (pwd !== ADMIN_PASSWORD) return fail(res, 'Forbidden', 403);
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Admin session check / logout helpers ──────────────────────────────────────
app.get('/api/admin/check', requireAdmin, (_req, res) => ok(res, { isAdmin: true }));
app.post('/api/admin/logout', (_req, res) => ok(res, { message: 'logged out' }));

// ═══ PUBLIC STORE SETTINGS ════════════════════════════════════════════════════
app.get('/api/store/settings', async (_req, res) => {
  try {
    const { rows } = await db(`SELECT key, value FROM admin_settings`);
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    ok(res, { settings });
  } catch (e) { fail(res, e.message); }
});

// ═══ AUTH ROUTES (Supabase) ═══════════════════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (rateLimit('reg:'+ip, 5, 3600000)) return fail(res, 'Too many registrations. Try again later.', 429);
  const { email, password, full_name, phone, country, role, experience, city } = req.body;
  if (!email || !password || !full_name) return fail(res, 'email, password and full_name are required');

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, password,
    email_confirm: true,
    user_metadata: { full_name, phone, country: country || 'Zambia' }
  });
  if (error) return fail(res, error.message);

  // upsert profile
  await db(`
    INSERT INTO user_profiles (id, email, full_name, phone, country, role)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (id) DO UPDATE SET full_name=$3, phone=$4, country=$5, role=$6, updated_at=NOW()
  `, [data.user.id, email, full_name, phone || null, country || 'Zambia', role || 'customer']);

  // if sales agent, save registration
  if (role === 'sales_agent') {
    await db(`
      INSERT INTO sales_registrations (user_id, full_name, email, phone, country, city, experience)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [data.user.id, full_name, email, phone || '', country || '', city || '', experience || '']);
  }

  ok(res, { user: { id: data.user.id, email, full_name, role: role || 'customer' } });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (rateLimit('login:'+ip, 10, 60000)) return fail(res, 'Too many login attempts. Wait 1 minute.', 429);
  const { email, password } = req.body;
  if (!email || !password) return fail(res, 'email and password required');

  const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password });
  if (error) return fail(res, error.message);

  const { rows } = await db(`SELECT * FROM user_profiles WHERE id=$1`, [data.user.id]);
  const profile = rows[0] || {};
  if (profile.is_disabled) return fail(res, 'Account has been disabled. Contact support.', 403);

  ok(res, {
    session: data.session,
    user: {
      id:        data.user.id,
      email:     data.user.email,
      full_name: profile.full_name || data.user.user_metadata?.full_name,
      phone:     profile.phone,
      country:   profile.country,
      role:      profile.role || 'customer'
    }
  });
});

// Get current user (from token)
app.get('/api/auth/user', requireUser, async (req, res) => {
  const { rows } = await db(`SELECT * FROM user_profiles WHERE id=$1`, [req.user.id]);
  const profile = rows[0] || {};
  ok(res, {
    user: {
      id:        req.user.id,
      email:     req.user.email,
      full_name: profile.full_name,
      phone:     profile.phone,
      country:   profile.country,
      role:      profile.role || 'customer'
    }
  });
});

// Forgot password (sends reset email via Supabase)
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return fail(res, 'email required');
  const { error } = await supabasePublic.auth.resetPasswordForEmail(email, {
    redirectTo: `${req.headers.origin || ''}/auth.html?mode=reset`
  });
  if (error) return fail(res, error.message);
  ok(res, { message: 'Password reset email sent' });
});

// Logout (client-side mostly, but invalidate server session too)
app.post('/api/auth/logout', requireUser, async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) await supabaseAdmin.auth.admin.signOut(token).catch(() => {});
  ok(res, { message: 'Logged out' });
});

// ═══ CART ROUTES ══════════════════════════════════════════════════════════════

// GET /api/cart — get cart for authenticated user (with product data)
app.get('/api/cart', requireUser, async (req, res) => {
  try {
    const { rows } = await db(`
      SELECT ci.id, ci.product_id, ci.quantity,
             p.name, p.price, p.discount, p.shipping_fee,
             p.images_store, p.stock, p.is_active
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = $1
      ORDER BY ci.created_at ASC
    `, [req.user.id]);
    ok(res, { items: rows });
  } catch (e) { fail(res, e.message); }
});

// POST /api/cart — add item
app.post('/api/cart', requireUser, async (req, res) => {
  try {
    const { product_id, quantity = 1 } = req.body;
    if (!product_id) return fail(res, 'product_id required');
    const { rows } = await db(`
      INSERT INTO cart_items (user_id, product_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, product_id)
        DO UPDATE SET quantity = cart_items.quantity + $3, updated_at = NOW()
      RETURNING *
    `, [req.user.id, product_id, quantity]);
    ok(res, { item: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// PATCH /api/cart/:id — update quantity
app.patch('/api/cart/:id', requireUser, async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return fail(res, 'quantity must be >= 1');
    const { rows } = await db(`
      UPDATE cart_items SET quantity=$1, updated_at=NOW()
      WHERE id=$2 AND user_id=$3
      RETURNING *
    `, [quantity, req.params.id, req.user.id]);
    if (!rows.length) return fail(res, 'Item not found', 404);
    ok(res, { item: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// DELETE /api/cart/:id — remove single item
app.delete('/api/cart/:id', requireUser, async (req, res) => {
  try {
    await db(`DELETE FROM cart_items WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    ok(res, { message: 'Removed' });
  } catch (e) { fail(res, e.message); }
});

// DELETE /api/cart — clear cart
app.delete('/api/cart', requireUser, async (req, res) => {
  try {
    await db(`DELETE FROM cart_items WHERE user_id=$1`, [req.user.id]);
    ok(res, { message: 'Cart cleared' });
  } catch (e) { fail(res, e.message); }
});

// ═══ FLASH SALES ══════════════════════════════════════════════════════════════

// GET /api/flash-sales — public: active flash sales only
app.get('/api/flash-sales', async (_req, res) => {
  try {
    const { rows } = await db(`
      SELECT * FROM flash_sales
      WHERE is_active = TRUE AND ends_at > NOW()
      ORDER BY created_at DESC
    `);
    ok(res, { flash_sales: rows });
  } catch (e) { fail(res, e.message); }
});

// GET /api/admin/flash-sales — admin: all
app.get('/api/admin/flash-sales', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM flash_sales ORDER BY created_at DESC`);
    ok(res, { flash_sales: rows });
  } catch (e) { fail(res, e.message); }
});

// POST /api/admin/flash-sales — create
app.post('/api/admin/flash-sales', requireAdmin, async (req, res) => {
  try {
    const { title, subtitle, discount_pct, discount_amt, badge_color, starts_at, ends_at, product_ids, is_active } = req.body;
    if (!title || !ends_at) return fail(res, 'title and ends_at required');
    const { rows } = await db(`
      INSERT INTO flash_sales (title, subtitle, discount_pct, discount_amt, badge_color, starts_at, ends_at, product_ids, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [title, subtitle||null, discount_pct||0, discount_amt||0, badge_color||'#e3001b', starts_at||new Date(), ends_at, product_ids||null, is_active!==false]);
    ok(res, { flash_sale: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// PATCH /api/admin/flash-sales/:id — update
app.patch('/api/admin/flash-sales/:id', requireAdmin, async (req, res) => {
  try {
    const { title, subtitle, discount_pct, discount_amt, badge_color, starts_at, ends_at, product_ids, is_active } = req.body;
    const { rows } = await db(`
      UPDATE flash_sales SET
        title        = COALESCE($1, title),
        subtitle     = COALESCE($2, subtitle),
        discount_pct = COALESCE($3, discount_pct),
        discount_amt = COALESCE($4, discount_amt),
        badge_color  = COALESCE($5, badge_color),
        starts_at    = COALESCE($6, starts_at),
        ends_at      = COALESCE($7, ends_at),
        product_ids  = COALESCE($8, product_ids),
        is_active    = COALESCE($9, is_active)
      WHERE id = $10
      RETURNING *
    `, [title, subtitle, discount_pct, discount_amt, badge_color, starts_at, ends_at, product_ids, is_active, req.params.id]);
    if (!rows.length) return fail(res, 'Not found', 404);
    ok(res, { flash_sale: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// DELETE /api/admin/flash-sales/:id
app.delete('/api/admin/flash-sales/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM flash_sales WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

// ═══ VOUCHERS ═════════════════════════════════════════════════════════════════

// POST /api/vouchers/validate — public: validate a voucher code
app.post('/api/vouchers/validate', async (req, res) => {
  try {
    const { code, amount, order_total } = req.body;
    if (!code) return fail(res, 'code required');
    const { rows } = await db(`
      SELECT * FROM vouchers
      WHERE UPPER(code) = UPPER($1)
        AND is_active = TRUE
        AND (valid_from IS NULL OR valid_from <= NOW())
        AND (valid_until IS NULL OR valid_until >= NOW())
        AND (max_uses = 0 OR times_used < max_uses)
    `, [code]);
    if (!rows.length) return fail(res, 'Invalid or expired voucher code');
    const v = rows[0];
    const orderAmt = parseFloat(amount || order_total) || 0;
    if (parseFloat(v.min_order_amt) > 0 && orderAmt < parseFloat(v.min_order_amt)) {
      return fail(res, `Minimum order of K${v.min_order_amt} required for this voucher`);
    }
    let discount_amount = v.discount_type === 'percent'
      ? orderAmt * parseFloat(v.discount_value) / 100
      : parseFloat(v.discount_value);
    discount_amount = Math.min(discount_amount, orderAmt > 0 ? orderAmt : discount_amount);
    ok(res, {
      valid: true, code: v.code,
      discount_type: v.discount_type,
      discount_value: parseFloat(v.discount_value),
      discount_amount: Math.round(discount_amount * 100) / 100,
      description: v.description || ''
    });
  } catch (e) { fail(res, e.message); }
});

// GET /api/admin/vouchers — admin: all vouchers
app.get('/api/admin/vouchers', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM vouchers ORDER BY created_at DESC`);
    ok(res, { coupons: rows });
  } catch (e) { fail(res, e.message); }
});

// POST /api/admin/vouchers — create
app.post('/api/admin/vouchers', requireAdmin, async (req, res) => {
  try {
    const { code, description, discount_type, discount_value, min_order_amt, max_uses, valid_from, valid_until, is_active } = req.body;
    if (!code || !discount_value) return fail(res, 'code and discount_value required');
    const { rows } = await db(`
      INSERT INTO vouchers (code, description, discount_type, discount_value, min_order_amt, max_uses, valid_from, valid_until, is_active)
      VALUES (UPPER($1),$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [code, description||null, discount_type||'percent', discount_value, min_order_amt||0, max_uses||100, valid_from||new Date(), valid_until||null, is_active!==false]);
    ok(res, { voucher: rows[0] });
  } catch (e) {
    if (e.code === '23505') return fail(res, 'Voucher code already exists');
    fail(res, e.message);
  }
});

// PATCH /api/admin/vouchers/:id — update
app.patch('/api/admin/vouchers/:id', requireAdmin, async (req, res) => {
  try {
    const { code, description, discount_type, discount_value, min_order_amt, max_uses, valid_from, valid_until, is_active } = req.body;
    const { rows } = await db(`
      UPDATE vouchers SET
        code           = COALESCE(UPPER($1), code),
        description    = COALESCE($2, description),
        discount_type  = COALESCE($3, discount_type),
        discount_value = COALESCE($4, discount_value),
        min_order_amt  = COALESCE($5, min_order_amt),
        max_uses       = COALESCE($6, max_uses),
        valid_from     = COALESCE($7, valid_from),
        valid_until    = COALESCE($8, valid_until),
        is_active      = COALESCE($9, is_active)
      WHERE id = $10
      RETURNING *
    `, [code, description, discount_type, discount_value, min_order_amt, max_uses, valid_from, valid_until, is_active, req.params.id]);
    if (!rows.length) return fail(res, 'Not found', 404);
    ok(res, { voucher: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// DELETE /api/admin/vouchers/:id
app.delete('/api/admin/vouchers/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM vouchers WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

// ═══ ADMIN SETTINGS ═══════════════════════════════════════════════════════════

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`SELECT key, value FROM admin_settings`);
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    ok(res, { settings });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await db(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
      `, [key, String(value)]);
    }
    ok(res, { message: 'Settings saved' });
  } catch (e) { fail(res, e.message); }
});

// ═══ ADMIN USERS ══════════════════════════════════════════════════════════════

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, q = '' } = req.query;
    const offset = (page - 1) * limit;
    let sql   = `SELECT * FROM user_profiles`;
    let params = [];
    if (q) {
      sql += ` WHERE full_name ILIKE $1 OR email ILIKE $1`;
      params.push(`%${q}%`);
      sql += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    } else {
      sql += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      params.push(limit, offset);
    }
    const { rows } = await db(sql, params);
    const count    = await db(`SELECT COUNT(*) FROM user_profiles${q ? " WHERE full_name ILIKE $1 OR email ILIKE $1" : ''}`, q ? [`%${q}%`] : []);
    ok(res, { users: rows, total: parseInt(count.rows[0].count) });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/users/:id/disable', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE user_profiles SET is_disabled=TRUE, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await supabaseAdmin.auth.admin.updateUserById(req.params.id, { ban_duration: '876600h' }).catch(() => {});
    ok(res, { message: 'User disabled' });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/users/:id/enable', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE user_profiles SET is_disabled=FALSE, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await supabaseAdmin.auth.admin.updateUserById(req.params.id, { ban_duration: 'none' }).catch(() => {});
    ok(res, { message: 'User enabled' });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['customer','sales_agent','admin'].includes(role)) return fail(res, 'Invalid role');
    await db(`UPDATE user_profiles SET role=$1, updated_at=NOW() WHERE id=$2`, [role, req.params.id]);
    ok(res, { message: 'Role updated' });
  } catch (e) { fail(res, e.message); }
});

// ═══ ADMIN SALES REGISTRATIONS ════════════════════════════════════════════════

app.get('/api/admin/sales-registrations', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM sales_registrations ORDER BY created_at DESC`);
    ok(res, { registrations: rows });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/sales-registrations/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await db(`
      UPDATE sales_registrations SET status=$1, reviewed_at=NOW() WHERE id=$2 RETURNING *
    `, [status, req.params.id]);
    if (rows[0]?.user_id && status === 'approved') {
      await db(`UPDATE user_profiles SET role='sales_agent' WHERE id=$1`, [rows[0].user_id]);
    }
    ok(res, { registration: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// ═══ PUBLIC SALES REGISTRATION ════════════════════════════════════════════════

app.post('/api/sales-registrations', async (req, res) => {
  try {
    const { full_name, email, phone, country, city, experience, user_id } = req.body;
    if (!full_name || !email || !phone || !country) return fail(res, 'full_name, email, phone, country required');
    const { rows } = await db(`
      INSERT INTO sales_registrations (user_id, full_name, email, phone, country, city, experience)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [user_id||null, full_name, email, phone, country, city||null, experience||null]);
    ok(res, { registration: rows[0] });
  } catch (e) { fail(res, e.message); }
});

// ═══ ADMIN LOGIN (password check) ═════════════════════════════════════════════
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return fail(res, 'Wrong password', 403);
  ok(res, { ok: true });
});

// ═══ CATEGORIES ═══════════════════════════════════════════════════════════════
app.get('/api/categories', async (_req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM categories ORDER BY sort_order ASC, name ASC`);
    ok(res, { categories: rows });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return fail(res, 'name required');
    const { rows } = await db(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=$1 RETURNING *`, [name.trim()]);
    ok(res, { category: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM categories WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

// ═══ PRODUCTS ═════════════════════════════════════════════════════════════════
app.get('/api/products', async (req, res) => {
  try {
    const { category, q, search, include_inactive, limit = 500 } = req.query;
    const searchTerm = q || search;
    const showAll = include_inactive === 'true';
    let sql    = `SELECT p.*,
      c.name AS category_name,
      COALESCE(AVG(r.rating),0)::NUMERIC(3,1) AS avg_rating,
      COUNT(r.id)::INT AS review_count
    FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    LEFT JOIN reviews r ON r.product_id=p.id AND r.status='approved'
    WHERE ${showAll ? '1=1' : 'p.is_active=TRUE'}`;
    const args = [];
    if (category && category !== 'all') { args.push(category); sql += ` AND c.name=$${args.length}`; }
    if (searchTerm) { args.push(`%${searchTerm}%`); sql += ` AND p.name ILIKE $${args.length}`; }
    sql += ` GROUP BY p.id, c.name ORDER BY p.sort_position ASC, p.created_at DESC LIMIT $${args.length+1}`;
    args.push(parseInt(limit));
    const { rows } = await db(sql, args);
    ok(res, { products: rows });
  } catch (e) { fail(res, e.message); }
});

app.get('/api/admin/products', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.sort_position ASC, p.created_at DESC`);
    ok(res, { products: rows });
  } catch (e) { fail(res, e.message); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { rows } = await db(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1`, [req.params.id]);
    if (!rows.length) return fail(res, 'Not found', 404);
    ok(res, { product: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/admin/products', requireAdmin, upload.fields([
  { name: 'store', maxCount: 5 },
  { name: 'carousel', maxCount: 20 },
  { name: 'detail', maxCount: 50 }
]), async (req, res) => {
  try {
    const b = req.body;
    const toURL = (files) => files ? files.map(f => '/uploads/' + f.filename) : [];
    const imagesStore    = toURL(req.files?.store);
    const imagesCarousel = toURL(req.files?.carousel);
    const imagesDetail   = toURL(req.files?.detail);

    let catId = null;
    if (b.category) {
      const cat = await db(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=$1 RETURNING id`, [b.category]);
      catId = cat.rows[0].id;
    }

    const { rows } = await db(`
      INSERT INTO products (name, description, category_id, price, prev_price, save_amount, discount,
        shipping_fee, stock, sales_count, badge, show_badge, sort_position, specs, how_to_use, colors,
        images_store, images_carousel, images_detail, deal_ends_at, is_featured)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `, [
      b.name, b.description||null, catId,
      b.price||0, b.prev_price||null, b.save_amount||null, b.discount||0,
      b.shipping_fee||0, b.stock||0, b.sales_count||0,
      b.badge||null, b.show_badge!=='false',
      b.sort_position||50, b.specs||null, b.how_to_use||null, b.colors||null,
      JSON.stringify(imagesStore), JSON.stringify(imagesCarousel), JSON.stringify(imagesDetail),
      b.deal_ends_at||null, b.is_featured==='true'
    ]);
    ok(res, { product: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/products/:id', requireAdmin, upload.fields([
  { name: 'store', maxCount: 5 },
  { name: 'carousel', maxCount: 20 },
  { name: 'detail', maxCount: 50 }
]), async (req, res) => {
  try {
    const b = req.body;
    const toURL = (files) => files ? files.map(f => '/uploads/' + f.filename) : null;
    const imagesStore    = toURL(req.files?.store);
    const imagesCarousel = toURL(req.files?.carousel);
    const imagesDetail   = toURL(req.files?.detail);

    let catId = undefined;
    if (b.category) {
      const cat = await db(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=$1 RETURNING id`, [b.category]);
      catId = cat.rows[0].id;
    }

    const { rows } = await db(`
      UPDATE products SET
        name          = COALESCE($1, name),
        description   = COALESCE($2, description),
        category_id   = COALESCE($3, category_id),
        price         = COALESCE($4, price),
        prev_price    = COALESCE($5, prev_price),
        save_amount   = COALESCE($6, save_amount),
        discount      = COALESCE($7, discount),
        shipping_fee  = COALESCE($8, shipping_fee),
        stock         = COALESCE($9, stock),
        sales_count   = COALESCE($10, sales_count),
        badge         = COALESCE($11, badge),
        show_badge    = COALESCE($12, show_badge),
        sort_position = COALESCE($13, sort_position),
        specs         = COALESCE($14, specs),
        how_to_use    = COALESCE($15, how_to_use),
        colors        = COALESCE($16, colors),
        images_store  = COALESCE($17, images_store),
        images_carousel = COALESCE($18, images_carousel),
        images_detail = COALESCE($19, images_detail),
        deal_ends_at  = COALESCE($20, deal_ends_at),
        is_featured   = COALESCE($21, is_featured),
        is_active     = COALESCE($22, is_active),
        updated_at    = NOW()
      WHERE id = $23
      RETURNING *
    `, [
      b.name||null, b.description||null, catId||null,
      b.price||null, b.prev_price||null, b.save_amount||null, b.discount||null,
      b.shipping_fee||null, b.stock||null, b.sales_count||null,
      b.badge||null, b.show_badge!=null ? b.show_badge!=='false' : null,
      b.sort_position||null, b.specs||null, b.how_to_use||null, b.colors||null,
      imagesStore ? JSON.stringify(imagesStore) : null,
      imagesCarousel ? JSON.stringify(imagesCarousel) : null,
      imagesDetail ? JSON.stringify(imagesDetail) : null,
      b.deal_ends_at||null,
      b.is_featured!=null ? b.is_featured==='true' : null,
      b.is_active!=null ? b.is_active!=='false' : null,
      req.params.id
    ]);
    if (!rows.length) return fail(res, 'Not found', 404);
    ok(res, { product: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/products/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`UPDATE products SET is_active=NOT is_active, updated_at=NOW() WHERE id=$1 RETURNING id, is_active`, [req.params.id]);
    ok(res, { product: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/products/:id/feature', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db(`UPDATE products SET is_featured=NOT is_featured, updated_at=NOW() WHERE id=$1 RETURNING id, is_featured`, [req.params.id]);
    ok(res, { product: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM products WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

// ═══ REVIEWS ══════════════════════════════════════════════════════════════════
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM reviews WHERE product_id=$1 AND status='approved' ORDER BY created_at DESC`, [req.params.id]);
    ok(res, { reviews: rows });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/products/:id/reviews', async (req, res) => {
  try {
    const { reviewer, rating, comment } = req.body;
    if (!reviewer || !rating) return fail(res, 'reviewer and rating required');
    const { rows } = await db(`INSERT INTO reviews (product_id, reviewer, rating, comment) VALUES ($1,$2,$3,$4) RETURNING *`, [req.params.id, reviewer, rating, comment||null]);
    ok(res, { review: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.get('/api/admin/reviews', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`
      SELECT r.*,
        r.reviewer AS customer_name,
        (r.status = 'approved') AS is_approved,
        p.name AS product_name,
        TO_CHAR(r.created_at, 'DD Mon YYYY') AS date_label
      FROM reviews r
      LEFT JOIN products p ON p.id=r.product_id
      ORDER BY r.created_at DESC
    `);
    ok(res, { reviews: rows });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await db(`UPDATE reviews SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
    ok(res, { review: rows[0], message: status === 'approved' ? 'Review approved and is now visible in the store.' : 'Review hidden from store.' });
  } catch (e) { fail(res, e.message); }
});

// Shortcut approve / decline / delete routes (called by frontend)
app.patch('/api/reviews/:id/approve', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE reviews SET status='approved' WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Review approved and is now visible in the store.' });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/reviews/:id/decline', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE reviews SET status='pending' WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Review hidden from store.' });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM reviews WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM reviews WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

// ═══ ORDERS ═══════════════════════════════════════════════════════════════════
app.post('/api/orders', async (req, res) => {
  try {
    const b = req.body;
    if (!b.customer_name || !b.customer_phone || !b.products_json) {
      return fail(res, 'customer_name, customer_phone, products_json required');
    }

    // decrement voucher uses if applicable
    if (b.voucher_code) {
      await db(`UPDATE vouchers SET times_used=times_used+1 WHERE UPPER(code)=UPPER($1)`, [b.voucher_code]).catch(() => {});
    }

    const orderNum = genNum('ZMF');
    const { rows } = await db(`
      INSERT INTO orders (order_number, user_id, customer_name, customer_phone, customer_email,
        customer_city, customer_addr1, customer_addr2, remark, products_json,
        subtotal, discount, voucher_discount, voucher_code, shipping_fee, total,
        payment_method, tx_ref, network, stk_phone)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *
    `, [
      orderNum, b.user_id||null, b.customer_name, b.customer_phone, b.customer_email||null,
      b.customer_city||null, b.customer_addr1||null, b.customer_addr2||null, b.remark||null,
      typeof b.products_json === 'string' ? b.products_json : JSON.stringify(b.products_json),
      b.subtotal||0, b.discount||0, b.voucher_discount||0, b.voucher_code||null,
      b.shipping_fee||0, b.total||0,
      b.payment_method||'pay_after', b.tx_ref||null, b.network||null, b.stk_phone||null
    ]);

    const order = rows[0];

    // notification
    await db(`INSERT INTO notifications (order_id, message) VALUES ($1,$2)`, [
      order.id, `New order ${orderNum} from ${b.customer_name}`
    ]);

    // low-stock check — notify admin if any ordered product has stock ≤ 5
    try {
      const pJson = typeof b.products_json === 'string' ? b.products_json : JSON.stringify(b.products_json);
      const prods = JSON.parse(pJson || '[]');
      for (const item of (Array.isArray(prods) ? prods : [])) {
        const pid = item.id || item.product_id;
        if (!pid) continue;
        const { rows: pRows } = await db(
          `SELECT id, name, stock FROM products WHERE id=$1 AND stock > 0 AND stock <= 5`, [pid]
        );
        if (pRows.length) {
          await db(`INSERT INTO notifications (message) VALUES ($1)`, [
            `⚠️ Low stock: "${pRows[0].name}" has only ${pRows[0].stock} unit${pRows[0].stock !== 1 ? 's' : ''} remaining`
          ]);
        }
      }
    } catch (_) {}

    // recent purchase pop-up entry
    const products = JSON.parse(typeof b.products_json === 'string' ? b.products_json : JSON.stringify(b.products_json));
    const pname    = Array.isArray(products) ? products[0]?.name : 'a product';
    await db(`INSERT INTO recent_purchases (name, product, location) VALUES ($1,$2,$3)`, [
      b.customer_name.split(' ')[0], pname, b.customer_city || 'Zambia'
    ]);

    ok(res, { order, order_number: orderNum });
  } catch (e) { fail(res, e.message); }
});

app.get('/api/orders/track', async (req, res) => {
  try {
    const phone = (req.query.phone || '').trim();
    if (!phone) return fail(res, 'phone required');
    const { rows } = await db(`SELECT * FROM orders WHERE customer_phone=$1 ORDER BY created_at DESC`, [phone]);
    // Parse products_json to expose first-product display fields
    const orders = rows.map(o => {
      let products = [];
      try { products = JSON.parse(o.products_json || '[]'); } catch (_) {}
      const first = Array.isArray(products) ? products[0] : {};
      return {
        ...o,
        status:        o.order_status,
        city:          o.customer_city,
        product_name:  first.name  || '',
        product_image: first.image || first.img || '',
        quantity:      first.qty   || first.quantity || 1
      };
    });
    ok(res, { orders });
  } catch (e) { fail(res, e.message); }
});

// Keep legacy path param for backward compat
app.get('/api/orders/track/:phone', async (req, res) => {
  req.query.phone = req.params.phone;
  const phone = req.params.phone;
  try {
    const { rows } = await db(`SELECT * FROM orders WHERE customer_phone=$1 ORDER BY created_at DESC`, [phone]);
    const orders = rows.map(o => {
      let products = [];
      try { products = JSON.parse(o.products_json || '[]'); } catch (_) {}
      const first = Array.isArray(products) ? products[0] : {};
      return { ...o, status: o.order_status, city: o.customer_city, product_name: first.name||'', product_image: first.image||first.img||'', quantity: first.qty||first.quantity||1 };
    });
    ok(res, { orders });
  } catch (e) { fail(res, e.message); }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { status, q, page = 1, limit = 100, user_id } = req.query;
    let countSql = `SELECT COUNT(*) FROM orders WHERE 1=1`;
    let sql      = `SELECT *,
      order_status     AS status,
      customer_name    AS name,
      customer_phone   AS phone,
      customer_city    AS city,
      customer_addr1   AS address1
    FROM orders WHERE 1=1`;
    const args = [];
    if (status) { args.push(status); sql += ` AND order_status=$${args.length}`; countSql += ` AND order_status=$${args.length}`; }
    if (user_id) { args.push(user_id); sql += ` AND user_id=$${args.length}`; countSql += ` AND user_id=$${args.length}`; }
    if (q) {
      args.push(`%${q}%`);
      const n = args.length;
      sql      += ` AND (customer_name ILIKE $${n} OR customer_phone ILIKE $${n} OR order_number ILIKE $${n})`;
      countSql += ` AND (customer_name ILIKE $${n} OR customer_phone ILIKE $${n} OR order_number ILIKE $${n})`;
    }
    sql += ` ORDER BY created_at DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`;
    const dataArgs = [...args, parseInt(limit), (parseInt(page)-1)*parseInt(limit)];
    const [{ rows }, { rows: cRows }] = await Promise.all([db(sql, dataArgs), db(countSql, args)]);
    // Parse products_json to surface display fields on each order
    const orders = rows.map(o => {
      let products = [];
      try { products = JSON.parse(o.products_json || '[]'); } catch (_) {}
      const first = Array.isArray(products) ? products[0] : {};
      return {
        ...o,
        product_name:   first.name  || '',
        product_image:  first.image || first.img || '',
        quantity:       first.qty   || first.quantity || 1,
        selected_color: first.color || first.selected_color || ''
      };
    });
    ok(res, { orders, total: parseInt(cRows[0].count) });
  } catch (e) { fail(res, e.message); }
});

// ── Bulk Status Update ──────────────────────────────────────────────────────
app.patch('/api/admin/orders/bulk-status', requireAdmin, async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || !ids.length || !status) return fail(res, 'ids[] and status required');
    await db(`UPDATE orders SET order_status=$1, updated_at=NOW() WHERE id=ANY($2::int[])`, [status, ids]);
    ok(res, { message: `${ids.length} order${ids.length !== 1 ? 's' : ''} updated to ${status}` });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await db(`UPDATE orders SET order_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [status, req.params.id]);
    ok(res, { order: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/orders/:id/payment', requireAdmin, async (req, res) => {
  try {
    const { payment_status } = req.body;
    const { rows } = await db(`UPDATE orders SET payment_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [payment_status, req.params.id]);
    ok(res, { order: rows[0] });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/orders/:id/read', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE orders SET is_read=TRUE WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'marked read' });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    await db(`DELETE FROM orders WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Deleted' });
  } catch (e) { fail(res, e.message); }
});

// CSV export (two paths: frontend uses /api/orders/export/csv)
app.get('/api/orders/export/csv', requireAdmin, async (_req, res) => {
  res.redirect(307, '/api/admin/orders/export.csv');
});
app.get('/api/admin/orders/export.csv', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM orders ORDER BY created_at DESC`);
    const headers = ['order_number','customer_name','customer_phone','customer_city','total','payment_method','payment_status','order_status','created_at'];
    const lines   = [headers.join(','), ...rows.map(r => headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(','))];
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment;filename=orders.csv');
    res.send(lines.join('\n'));
  } catch (e) { fail(res, e.message); }
});

// ═══ NOTIFICATIONS ════════════════════════════════════════════════════════════
app.get('/api/admin/notifications', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`
      SELECT n.*,
        o.order_number, o.customer_name, o.customer_phone AS phone,
        o.customer_city AS city, o.customer_addr1 AS address1,
        o.remark, o.total, o.payment_method, o.order_status AS status,
        o.products_json
      FROM notifications n
      LEFT JOIN orders o ON o.id = n.order_id
      ORDER BY n.created_at DESC LIMIT 100
    `);
    const unread = rows.filter(r => !r.is_read).length;
    // Parse first product from products_json for display
    const notifications = rows.map(n => {
      let products = [];
      try { products = JSON.parse(n.products_json || '[]'); } catch (_) {}
      const first = Array.isArray(products) ? products[0] : {};
      return {
        ...n,
        product_name:   first.name     || '',
        product_image:  first.image    || first.img || '',
        quantity:       first.qty      || first.quantity || 1,
        selected_color: first.color    || first.selected_color || '',
      };
    });
    ok(res, { notifications, unreadCount: unread });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/notifications/:id/read', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE notifications SET is_read=TRUE WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'read' });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/notifications/read-all', requireAdmin, async (_req, res) => {
  try {
    await db(`UPDATE notifications SET is_read=TRUE WHERE is_read=FALSE`);
    ok(res, { message: 'all read' });
  } catch (e) { fail(res, e.message); }
});

// ═══ RECENT PURCHASES (social proof) ══════════════════════════════════════════
app.get('/api/recent-purchases', async (_req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM recent_purchases ORDER BY created_at DESC LIMIT 20`);
    ok(res, { purchases: rows });
  } catch (e) { fail(res, e.message); }
});

// ═══ STATS ════════════════════════════════════════════════════════════════════
app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    const [orders, revenue, products, users, pending] = await Promise.all([
      db(`SELECT COUNT(*) FROM orders`),
      db(`SELECT COALESCE(SUM(total),0) AS rev FROM orders WHERE payment_status='paid'`),
      db(`SELECT COUNT(*) FROM products WHERE is_active=TRUE`),
      db(`SELECT COUNT(*) FROM user_profiles`),
      db(`SELECT COUNT(*) FROM orders WHERE order_status='pending'`)
    ]);
    ok(res, {
      totalOrders:    parseInt(orders.rows[0].count),
      totalRevenue:   parseFloat(revenue.rows[0].rev),
      activeProducts: parseInt(products.rows[0].count),
      totalUsers:     parseInt(users.rows[0].count),
      pendingOrders:  parseInt(pending.rows[0].count),
      // keep snake_case aliases for any other consumers
      total_orders:   parseInt(orders.rows[0].count),
      total_revenue:  parseFloat(revenue.rows[0].rev),
      active_products: parseInt(products.rows[0].count),
      total_users:    parseInt(users.rows[0].count)
    });
  } catch (e) { fail(res, e.message); }
});


// ═══ ANALYTICS ════════════════════════════════════════════════════════════════
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const { rows } = await db(`
      SELECT
        DATE(created_at AT TIME ZONE 'Africa/Lusaka') AS date,
        COUNT(*)::int                                 AS orders,
        COALESCE(SUM(total), 0)::numeric              AS revenue
      FROM orders
      WHERE created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY DATE(created_at AT TIME ZONE 'Africa/Lusaka')
      ORDER BY date ASC
    `, [days]);
    ok(res, { days: rows });
  } catch (e) { fail(res, e.message); }
});

// ═══ RESTOCK ALERTS ═══════════════════════════════════════════════════════════
app.post('/api/store/restock-notify', async (req, res) => {
  try {
    const { product_id, name, contact } = req.body;
    if (!contact) return fail(res, 'contact required');
    // Rate-limit per contact per product (max 1/hour)
    if (rateLimit('restock:' + (contact||'') + ':' + product_id, 1, 3600000)) {
      return ok(res, { message: 'Already registered' });
    }
    // Get product name
    let product_name = '';
    try {
      const { rows } = await db(`SELECT name FROM products WHERE id=$1`, [product_id]);
      if (rows.length) product_name = rows[0].name;
    } catch (_) {}
    // Remove any previous un-notified alert for same contact+product
    await db(`DELETE FROM restock_alerts WHERE product_id=$1 AND contact=$2 AND notified_at IS NULL`, [product_id, contact]);
    await db(`INSERT INTO restock_alerts (product_id, product_name, name, contact) VALUES ($1,$2,$3,$4)`,
      [product_id, product_name, name || null, contact]);
    ok(res, { message: 'Registered for restock notification' });
  } catch (e) { fail(res, e.message); }
});

app.get('/api/admin/restock-alerts', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db(`
      SELECT ra.*, p.name AS current_product_name, p.stock
      FROM restock_alerts ra
      LEFT JOIN products p ON p.id = ra.product_id
      WHERE ra.notified_at IS NULL
      ORDER BY ra.created_at DESC
      LIMIT 200
    `);
    ok(res, { alerts: rows });
  } catch (e) { fail(res, e.message); }
});

app.patch('/api/admin/restock-alerts/:id/notified', requireAdmin, async (req, res) => {
  try {
    await db(`UPDATE restock_alerts SET notified_at=NOW() WHERE id=$1`, [req.params.id]);
    ok(res, { message: 'Marked notified' });
  } catch (e) { fail(res, e.message); }
});

// ═══ SHARE PAGES ══════════════════════════════════════════════════════════════
app.get('/p/:id', async (req, res) => {
  try {
    const { rows } = await db(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.redirect('/');
    const p   = rows[0];
    const img = JSON.parse(p.images_store||'[]')[0]||'';
    res.send(`<!DOCTYPE html><html><head>
      <title>${p.name} — Zmafrdeal</title>
      <meta property="og:title" content="${p.name}"/>
      <meta property="og:description" content="${(p.description||'').slice(0,160)}"/>
      <meta property="og:image" content="${img}"/>
      <meta http-equiv="refresh" content="0;url=/?pid=${p.id}"/>
    </head><body>Redirecting…</body></html>`);
  } catch (e) { res.redirect('/'); }
});

app.get('/c/:name', async (req, res) => {
  res.redirect(`/?cat=${encodeURIComponent(req.params.name)}`);
});

// ─── Start server ─────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀  Zmafrdeal server running on port ${PORT}`);
  });
}).catch(e => {
  console.error('❌  DB init failed:', e.message);
  process.exit(1);
});
