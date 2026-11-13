const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Columns accepted on insert/update (order matters — matches SQL below)
const STUDENT_COLS = [
  'student_number', 'first_name', 'last_name', 'email', 'phone',
  'date_of_birth', 'gender', 'department_id', 'year_level',
  'enrollment_date', 'status', 'address',
];

// ─── Setup ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || '8e6dc8ca-22f9-5450-b7e0-4e187171e00e',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.staffId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function validateStudent(body) {
  const errors = [];
  const req = (v, name) => { if (!v || String(v).trim() === '') errors.push(`${name} is required`); };
  req(body.first_name, 'first_name');
  req(body.last_name, 'last_name');
  req(body.email, 'email');
  req(body.student_number, 'student_number');
  req(body.department_id, 'department_id');

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    errors.push('email is invalid');
  if (body.student_number && !/^STU-\d{4}-\d{4}$/.test(body.student_number))
    errors.push('student_number must match STU-YYYY-NNNN');
  if (body.year_level != null) {
    const y = Number(body.year_level);
    if (!Number.isInteger(y) || y < 1 || y > 5) errors.push('year_level must be 1–5');
  }
  if (body.status && !['active', 'suspended', 'graduated'].includes(body.status))
    errors.push('status must be active, suspended, or graduated');

  return errors;
}

// Normalize a student payload — null out blanks, coerce numerics, default status
function pickStudent(body) {
  const out = {};
  for (const k of STUDENT_COLS) {
    const v = body[k];
    out[k] = v === '' || v == null ? null : v;
  }
  if (out.department_id) out.department_id = Number(out.department_id);
  if (out.year_level)    out.year_level    = Number(out.year_level);
  if (!out.status)       out.status        = 'active';
  return out;
}

// Wrap a write handler: validation + UNIQUE conflict + generic 500
function wrapWrite(handler) {
  return (req, res) => {
    const errors = validateStudent(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    try { handler(req, res, pickStudent(req.body)); }
    catch (e) {
      if (String(e.message).includes('UNIQUE'))
        return res.status(409).json({ error: 'student_number or email already exists' });
      res.status(500).json({ error: 'Database error' });
    }
  };
}

// Shared SELECT for the common student+department shape
const STUDENT_SELECT = `
  SELECT s.*, d.code AS department_code, d.name AS department_name
  FROM students s
  LEFT JOIN departments d ON d.id = s.department_id
`;

// ─── Router (all routes below require auth) ────────────────────────────────
const r = express.Router();
r.use(requireAuth);

// Auth (except login/logout — those go on the app, not the router)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });

  const staff = db.prepare('SELECT * FROM staff WHERE username = ?').get(username);
  if (!staff || !bcrypt.compareSync(password, staff.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });

  req.session.staffId = staff.id;
  req.session.save(() => res.json({
    id: staff.id, username: staff.username,
    full_name: staff.full_name, role: staff.role,
  }));
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

r.get('/auth/me', (req, res) => {
  const staff = db
    .prepare('SELECT id, username, full_name, role FROM staff WHERE id = ?')
    .get(req.session.staffId);
  res.json(staff);
});

// ─── Students ──────────────────────────────────────────────────────────────
r.get('/students', (req, res) => {
  const { search = '', department = '', status = '', page = 1 } = req.query;
  const limit = 10;
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  const where = [];
  const params = [];
  if (search) {
    where.push('(s.first_name LIKE ? OR s.last_name LIKE ? OR s.student_number LIKE ? OR s.email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (department) { where.push('d.code = ?');   params.push(department); }
  if (status)     { where.push('s.status = ?'); params.push(status); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM students s
    LEFT JOIN departments d ON d.id = s.department_id
    ${whereSql}
  `).get(...params).n;

  const students = db.prepare(`
    ${STUDENT_SELECT}
    ${whereSql}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, page: Number(page), limit, students });
});

r.get('/students/:id', (req, res) => {
  const row = db.prepare(`${STUDENT_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(row);
});

r.post('/students', wrapWrite((req, res, s) => {
  const placeholders = STUDENT_COLS.map(() => '?').join(', ');
  const info = db.prepare(`
    INSERT INTO students (${STUDENT_COLS.join(', ')})
    VALUES (${placeholders})
  `).run(...STUDENT_COLS.map(k => s[k]));
  res.status(201).json({ id: info.lastInsertRowid });
}));

r.put('/students/:id', wrapWrite((req, res, s) => {
  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  const setClause = STUDENT_COLS.map(k => `${k} = ?`).join(', ');
  db.prepare(`
    UPDATE students SET ${setClause}, updated_at = datetime('now')
    WHERE id = ?
  `).run(...STUDENT_COLS.map(k => s[k]), req.params.id);
  res.json({ ok: true });
}));

r.delete('/students/:id', (req, res) => {
  const info = db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Student not found' });
  res.json({ ok: true });
});

// ─── Departments ───────────────────────────────────────────────────────────
const DEPT_SELECT = `
  SELECT d.*, COUNT(s.id) AS student_count
  FROM departments d
  LEFT JOIN students s ON s.department_id = d.id
`;

r.get('/departments', (req, res) => {
  res.json(db.prepare(`${DEPT_SELECT} GROUP BY d.id ORDER BY d.code`).all());
});

r.get('/departments/:id', (req, res) => {
  const row = db.prepare(`${DEPT_SELECT} WHERE d.id = ? GROUP BY d.id`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Department not found' });
  res.json(row);
});

// ─── Settings ──────────────────────────────────────────────────────────────
r.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings WHERE staff_id = ?')
    .all(req.session.staffId);
  res.json(Object.fromEntries(rows.map(x => [x.key, x.value])));
});

r.put('/settings', (req, res) => {
  const allowed = ['rows_per_page', 'theme', 'default_department'];
  const upsert = db.prepare(`
    INSERT INTO settings (staff_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(staff_id, key) DO UPDATE SET value = excluded.value
  `);
  const payload = req.body || {};
  db.transaction(() => {
    for (const key of allowed)
      if (key in payload) upsert.run(req.session.staffId, key, String(payload[key]));
  })();
  res.json({ ok: true });
});

// ─── Dashboard summary ─────────────────────────────────────────────────────
r.get('/dashboard/summary', (req, res) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS totalStudents,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeStudents,
      SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) AS thisMonth
    FROM students
  `).get();

  const totalDepartments = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;

  const recent = db.prepare(`
    SELECT s.id, s.student_number, s.first_name, s.last_name, s.created_at,
           d.code AS department_code
    FROM students s
    LEFT JOIN departments d ON d.id = s.department_id
    ORDER BY s.created_at DESC
    LIMIT 5
  `).all();

  res.json({
    totalStudents: counts.totalStudents,
    activeStudents: counts.activeStudents || 0,
    totalDepartments,
    thisMonth: counts.thisMonth || 0,
    recent,
  });
});

// Mount router under /api
app.use('/api', r);

// ─── Static + fallback ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Listen ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Recorda running at http://localhost:${PORT}`);
  console.log(`Login with: admin / admin123`);
});

module.exports = app;
