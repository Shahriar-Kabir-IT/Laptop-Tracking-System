import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve dashboard for root route (must be BEFORE static middleware)
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'web', 'index.html');
  res.sendFile(path.resolve(indexPath));
});

// Serve static files from web directory
app.use(express.static(path.join(__dirname, '..', 'web')));

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const CLIENT_TOKEN = process.env.CLIENT_TOKEN || 'dev_client_token';
const ONLINE_THRESHOLD_SECONDS = Number(process.env.ONLINE_THRESHOLD_SECONDS || 3600);
const ACCEPTED_TOKENS = new Set([CLIENT_TOKEN, 'dev_client_token']);
const DEFAULT_DELETE_CODES = ['E845628'];
const ENV_DELETE_CODES = (process.env.DELETE_CODES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const STARTUP_DELETE_CODES = Array.from(new Set([...DEFAULT_DELETE_CODES, ...ENV_DELETE_CODES]));
let DB_FILE = process.env.DB_FILE;
if (!DB_FILE) {
  const base =
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'LaptopTracker')
      : path.join(os.homedir(), '.laptoptracker');
  if (!fs.existsSync(base)) {
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch {}
  }
  DB_FILE = path.join(base, 'tracker.db');
}

let db;

async function initDb() {
  if (DB_FILE !== ':memory:') {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      employee_code TEXT UNIQUE NOT NULL,
      FOREIGN KEY(department_id) REFERENCES departments(id)
    );
    CREATE TABLE IF NOT EXISTS laptops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      employee_id INTEGER NOT NULL,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      laptop_id INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY(laptop_id) REFERENCES laptops(id)
    );
  `);

  // Seed departments if empty
  const deptCountRow = await db.get('SELECT COUNT(*) as count FROM departments');
  if (deptCountRow.count === 0) {
    const departments = [
      'HR',
      'ICT',
      'ADMIN',
      'Commercial',
      'Merchandising',
      'Audit',
      'Account',
      'Supplychain'
    ];
    for (const name of departments) {
      await db.run('INSERT INTO departments (name) VALUES (?)', name);
    }
  }

  // Seed some example employees if empty
  const empCountRow = await db.get('SELECT COUNT(*) as count FROM employees');
  if (empCountRow.count === 0) {
    const exampleEmployees = [
      { name: 'Alice HR', dept: 'HR', code: 'E1001' },
      { name: 'Bob ICT', dept: 'ICT', code: 'E1002' },
      { name: 'Carol Admin', dept: 'ADMIN', code: 'E1003' },
      { name: 'Dave Commercial', dept: 'Commercial', code: 'E1004' }
    ];

    for (const emp of exampleEmployees) {
      const dept = await db.get('SELECT id FROM departments WHERE name = ?', emp.dept);
      if (dept) {
        await db.run(
          'INSERT INTO employees (full_name, department_id, employee_code) VALUES (?, ?, ?)',
          emp.name,
          dept.id,
          emp.code
        );
      }
    }
  }
}

// Simple helper to create a single admin user in memory
let adminPasswordHash = null;
function initAdmin() {
  adminPasswordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
}

function generateToken(adminId) {
  return jwt.sign({ sub: adminId, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Missing Authorization header' });

  const [, token] = authHeader.split(' ');
  if (!token) return res.status(401).json({ message: 'Invalid Authorization header' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Client authentication for location updates
function clientAuthMiddleware(req, res, next) {
  const token = req.headers['x-client-token'];
  if (!token || !ACCEPTED_TOKENS.has(token)) {
    return res.status(401).json({ message: 'Invalid client token' });
  }
  next();
}

// --- Auth routes (for admin dashboard) ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const isMatch = bcrypt.compareSync(password, adminPasswordHash);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = generateToken(1);
  res.json({ token });
});

// --- Admin APIs ---

app.get('/api/departments', authMiddleware, async (req, res) => {
  const rows = await db.all('SELECT id, name FROM departments ORDER BY name');
  res.json(rows);
});

app.get('/api/departments/:id/employees', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const rows = await db.all(
    'SELECT id, full_name, employee_code FROM employees WHERE department_id = ? ORDER BY full_name',
    id
  );
  res.json(rows);
});

app.get('/api/employees/:id/last-location', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const laptop = await db.get('SELECT id FROM laptops WHERE employee_id = ?', id);
  if (!laptop) {
    return res.json({ location: null, isOnline: false, ageSeconds: null, thresholdSeconds: ONLINE_THRESHOLD_SECONDS, serverTime: new Date().toISOString() });
  }

  const loc = await db.get(
    'SELECT latitude, longitude, recorded_at FROM locations WHERE laptop_id = ? ORDER BY recorded_at DESC LIMIT 1',
    laptop.id
  );

  if (!loc) {
    return res.json({ location: null, isOnline: false, ageSeconds: null, thresholdSeconds: ONLINE_THRESHOLD_SECONDS, serverTime: new Date().toISOString() });
  }

  const ageSeconds = Math.floor((Date.now() - new Date(loc.recorded_at).getTime()) / 1000);
  const isOnline = ageSeconds <= ONLINE_THRESHOLD_SECONDS;
  res.json({ location: loc, isOnline, ageSeconds, thresholdSeconds: ONLINE_THRESHOLD_SECONDS, serverTime: new Date().toISOString() });
});

app.post('/api/admin/delete-employees', authMiddleware, async (req, res) => {
  const { employeeCodes } = req.body || {};
  if (!employeeCodes || !Array.isArray(employeeCodes) || employeeCodes.length === 0) {
    return res.status(400).json({ message: 'employeeCodes array required' });
  }
  let deleted = 0;
  for (const code of employeeCodes) {
    const emp = await db.get('SELECT id FROM employees WHERE employee_code = ?', code);
    if (!emp) continue;
    const laptops = await db.all('SELECT id FROM laptops WHERE employee_id = ?', emp.id);
    for (const l of laptops) {
      await db.run('DELETE FROM locations WHERE laptop_id = ?', l.id);
    }
    await db.run('DELETE FROM laptops WHERE employee_id = ?', emp.id);
    await db.run('DELETE FROM employees WHERE id = ?', emp.id);
    deleted++;
  }
  res.json({ deleted });
});

app.post('/api/admin/delete-department', authMiddleware, async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'department name required' });
  }
  const dept = await db.get('SELECT id FROM departments WHERE name = ?', name);
  if (!dept) {
    return res.json({ deleted: false, message: 'department not found' });
  }
  const employees = await db.all('SELECT id FROM employees WHERE department_id = ?', dept.id);
  for (const emp of employees) {
    const laptops = await db.all('SELECT id FROM laptops WHERE employee_id = ?', emp.id);
    for (const l of laptops) {
      await db.run('DELETE FROM locations WHERE laptop_id = ?', l.id);
    }
    await db.run('DELETE FROM laptops WHERE employee_id = ?', emp.id);
    await db.run('DELETE FROM employees WHERE id = ?', emp.id);
  }
  await db.run('DELETE FROM departments WHERE id = ?', dept.id);
  res.json({ deleted: true });
});

app.post('/api/admin/purge-department-except', authMiddleware, async (req, res) => {
  const { departmentName, keepNames = [], keepCodes = [] } = req.body || {};
  if (!departmentName || typeof departmentName !== 'string') {
    return res.status(400).json({ message: 'departmentName required' });
  }
  const dept = await db.get('SELECT id FROM departments WHERE name = ?', departmentName);
  if (!dept) {
    return res.status(404).json({ message: 'department not found' });
  }
  const employees = await db.all('SELECT id, full_name, employee_code FROM employees WHERE department_id = ?', dept.id);
  const keepNamesLC = Array.isArray(keepNames) ? keepNames.map(n => String(n).toLowerCase()) : [];
  const keepCodesSet = new Set(Array.isArray(keepCodes) ? keepCodes : []);
  let deleted = 0;
  for (const emp of employees) {
    const nameLc = String(emp.full_name).toLowerCase();
    const shouldKeepByName = keepNamesLC.some(kn => nameLc.includes(kn));
    const shouldKeepByCode = keepCodesSet.has(emp.employee_code);
    if (shouldKeepByName || shouldKeepByCode) continue;
    const laptops = await db.all('SELECT id FROM laptops WHERE employee_id = ?', emp.id);
    for (const l of laptops) {
      await db.run('DELETE FROM locations WHERE laptop_id = ?', l.id);
    }
    await db.run('DELETE FROM laptops WHERE employee_id = ?', emp.id);
    await db.run('DELETE FROM employees WHERE id = ?', emp.id);
    deleted++;
  }
  res.json({ departmentName, keptByName: keepNamesLC.length, keptByCode: keepCodesSet.size, deleted });
});
// Optional: history
app.get('/api/employees/:id/locations', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { from, to, limit = 100 } = req.query;

  const laptop = await db.get('SELECT id FROM laptops WHERE employee_id = ?', id);
  if (!laptop) {
    return res.json({ locations: [] });
  }

  let query = 'SELECT latitude, longitude, recorded_at FROM locations WHERE laptop_id = ?';
  const params = [laptop.id];

  if (from) {
    query += ' AND recorded_at >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND recorded_at <= ?';
    params.push(to);
  }
  query += ' ORDER BY recorded_at DESC LIMIT ?';
  params.push(Number(limit));

  const rows = await db.all(query, ...params);
  res.json({ locations: rows });
});

// --- Client API for laptops to send location ---

app.post('/api/location', clientAuthMiddleware, async (req, res) => {
  const { deviceId, employeeCode, latitude, longitude, timestamp } = req.body;

  if (!deviceId || !employeeCode || latitude == null || longitude == null) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const employee = await db.get(
    'SELECT id FROM employees WHERE employee_code = ?',
    employeeCode
  );
  if (!employee) {
    return res.status(400).json({ message: 'Unknown employee code' });
  }

  let laptop = await db.get('SELECT id FROM laptops WHERE device_id = ?', deviceId);
  if (!laptop) {
    const result = await db.run(
      'INSERT INTO laptops (device_id, employee_id) VALUES (?, ?)',
      deviceId,
      employee.id
    );
    laptop = { id: result.lastID };
  }

  const recordedAt = new Date().toISOString();

  await db.run(
    'INSERT INTO locations (laptop_id, latitude, longitude, recorded_at) VALUES (?, ?, ?, ?)',
    laptop.id,
    latitude,
    longitude,
    recordedAt
  );

  res.json({ message: 'Location stored' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Reset all users, laptops, and locations
app.post('/api/reset', clientAuthMiddleware, async (req, res) => {
  await db.exec('DELETE FROM locations');
  await db.exec('DELETE FROM laptops');
  await db.exec('DELETE FROM employees');
  res.json({ message: 'Reset completed' });
});

// Provision an employee and link current device (no token required to simplify first-time setup)
app.post('/api/provision', async (req, res) => {
  const { deviceId, employeeName, departmentName } = req.body;
  if (!deviceId || !employeeName || !departmentName) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  let dept = await db.get('SELECT id FROM departments WHERE name = ?', departmentName);
  if (!dept) {
    const r = await db.run('INSERT INTO departments (name) VALUES (?)', departmentName);
    dept = { id: r.lastID };
  }

  const employeeCode = 'E' + Math.floor(100000 + Math.random() * 900000);
  const empRes = await db.run(
    'INSERT INTO employees (full_name, department_id, employee_code) VALUES (?, ?, ?)',
    employeeName,
    dept.id,
    employeeCode
  );
  const emp = { id: empRes.lastID, code: employeeCode };

  let laptop = await db.get('SELECT id FROM laptops WHERE device_id = ?', deviceId);
  if (!laptop) {
    const lr = await db.run('INSERT INTO laptops (device_id, employee_id) VALUES (?, ?)', deviceId, emp.id);
    laptop = { id: lr.lastID };
  } else {
    await db.run('UPDATE laptops SET employee_id = ? WHERE id = ?', emp.id, laptop.id);
  }

  res.json({ employeeId: emp.id, employeeCode });
});

function startServer(port, attempts = 0) {
  const server = app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attempts < 10) {
      const nextPort = Number(port) + 1;
      console.log(`Port ${port} in use, trying ${nextPort}...`);
      startServer(nextPort, attempts + 1);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

async function purgeEmployeesByCodes(codes) {
  for (const code of codes) {
    const emp = await db.get('SELECT id FROM employees WHERE employee_code = ?', code);
    if (!emp) continue;
    const laptops = await db.all('SELECT id FROM laptops WHERE employee_id = ?', emp.id);
    for (const l of laptops) {
      await db.run('DELETE FROM locations WHERE laptop_id = ?', l.id);
    }
    await db.run('DELETE FROM laptops WHERE employee_id = ?', emp.id);
    await db.run('DELETE FROM employees WHERE id = ?', emp.id);
  }
}

// Start server
(async () => {
  await initDb();
  initAdmin();
  if (STARTUP_DELETE_CODES.length > 0) {
    try {
      await purgeEmployeesByCodes(STARTUP_DELETE_CODES);
    } catch {}
  }
  startServer(PORT);
})();


