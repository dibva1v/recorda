const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'recorda.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS departments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    head        TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS students (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_number  TEXT UNIQUE NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    phone           TEXT,
    date_of_birth   TEXT,
    gender          TEXT,
    department_id   INTEGER REFERENCES departments(id),
    year_level      INTEGER,
    enrollment_date TEXT,
    status          TEXT DEFAULT 'active',
    address         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id   INTEGER REFERENCES staff(id),
    key        TEXT NOT NULL,
    value      TEXT,
    UNIQUE(staff_id, key)
  );
`);

// ─── Seed (only runs if empty) ─────────────────────────────────────────────
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function seed() {
  const year = new Date().getFullYear();

  db.transaction(() => {
    if (count('staff') === 0) {
      db.prepare(
        'INSERT INTO staff (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
      ).run('admin', bcrypt.hashSync('admin123', 10), 'Admin User', 'admin');
    }

    if (count('departments') === 0) {
      const insertDept = db.prepare(
        'INSERT INTO departments (code, name, head, description) VALUES (?, ?, ?, ?)'
      );
      [
        ['CS',  'Computer Science',        'Dr. Amara Nwosu',  'Software, AI, and systems.'],
        ['EE',  'Electrical Engineering',  'Dr. Liam Okafor',  'Circuits, power, and signals.'],
        ['ME',  'Mechanical Engineering',  'Dr. Sofia Reyes',  'Thermodynamics and design.'],
        ['BA',  'Business Administration', 'Dr. Kwame Mensah', 'Management and finance.'],
        ['MED', 'Medicine',                'Dr. Hannah Park',  'Clinical and pre-med tracks.'],
      ].forEach(d => insertDept.run(...d));
    }

    if (count('students') === 0) {
      const deptId = new Map(
        db.prepare('SELECT code, id FROM departments').all().map(d => [d.code, d.id])
      );
      const insert = db.prepare(`
        INSERT INTO students
          (student_number, first_name, last_name, email, phone, date_of_birth,
           gender, department_id, year_level, enrollment_date, status, address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      [
        ['Alice',   'Johnson',  'CS',  2, 'active',    'female'],
        ['Brian',   'Kimani',   'EE',  1, 'active',    'male'],
        ['Chloe',   'Martins',  'BA',  3, 'active',    'female'],
        ['David',   'Osei',     'ME',  4, 'suspended', 'male'],
        ['Esi',     'Mensah',   'MED', 1, 'active',    'female'],
      ].forEach(([first, last, deptCode, yearLevel, status, gender], i) => {
        const email = `${first.toLowerCase()}.${last.toLowerCase()}@university.edu`;
        insert.run(
          `STU-${year}-${String(i + 1).padStart(4, '0')}`,
          first, last, email, '+1-555-0100', '2002-05-14',
          gender, deptId.get(deptCode), yearLevel, `${year}-09-01`,
          status, 'Campus Residence'
        );
      });
    }
  })();
}

seed();

module.exports = db;