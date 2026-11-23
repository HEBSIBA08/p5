const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

// 1. Meaningful request & response timing logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`
    );
  });
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});
app.use("/api", apiLimiter);

// SQLite setup
const dbDir = path.join(__dirname, "db");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, "internships.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("[DB ERROR] Failed to connect to SQLite:", err.message);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS internships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      mode TEXT NOT NULL,
      stipend TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internship_id INTEGER NOT NULL,
      applicant_name TEXT NOT NULL,
      email TEXT NOT NULL,
      cover_note TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (internship_id) REFERENCES internships(id)
    )
  `);

  db.get("SELECT COUNT(*) AS count FROM internships", [], (err, row) => {
    if (!err && row && row.count === 0) {
      const seedStmt = db.prepare(
        `INSERT INTO internships (title, company, location, mode, stipend) VALUES (?, ?, ?, ?, ?)`
      );
      seedStmt.run("Full Stack Intern", "Edvyro Labs", "Remote", "Remote", "₹15,000/mo");
      seedStmt.run("Frontend UI Intern", "PixelCraft Studio", "Bengaluru", "Hybrid", "₹12,000/mo");
      seedStmt.run("Backend API Intern", "DataGrid Systems", "Chennai", "On-site", "₹14,000/mo");
      seedStmt.finalize();
    }
  });
});

// 2. Health check endpoint
app.get("/health", (req, res) => {
  db.get("SELECT 1 AS ok", [], (err) => {
    if (err) {
      console.error("[HEALTH FAIL] Database check failed:", err.message);
      return res.status(503).json({
        status: "degraded",
        database: "unreachable",
        timestamp: new Date().toISOString()
      });
    }
    res.status(200).json({
      status: "ok",
      database: "connected",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });
});

// GET /api/internships
app.get("/api/internships", (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const offset = (page - 1) * limit;

  db.get("SELECT COUNT(*) AS total FROM internships", [], (countErr, countRow) => {
    if (countErr) {
      console.error("[API ERROR] Count query failed:", countErr.message);
      return res.status(500).json({ error: "Failed to count internships" });
    }

    db.all(
      "SELECT * FROM internships ORDER BY id DESC LIMIT ? OFFSET ?",
      [limit, offset],
      (err, rows) => {
        if (err) {
          console.error("[API ERROR] Fetch internships failed:", err.message);
          return res.status(500).json({ error: "Failed to fetch internships" });
        }
        res.json({
          data: rows,
          pagination: { page, limit, total: countRow.total }
        });
      }
    );
  });
});

// POST /api/applications
app.post("/api/applications", (req, res) => {
  const { internship_id, applicant_name, email, cover_note } = req.body || {};
  const errors = [];

  const parsedId = Number(internship_id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    errors.push("Please select a valid internship.");
  }
  if (typeof applicant_name !== "string" || applicant_name.trim().length < 2) {
    errors.push("Full name must be at least 2 characters.");
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.push("Please provide a valid email address.");
  }
  if (typeof cover_note !== "string" || cover_note.trim().length < 10) {
    errors.push("Cover note must be at least 10 characters.");
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  db.get("SELECT id FROM internships WHERE id = ?", [parsedId], (lookupErr, internship) => {
    if (lookupErr) {
      console.error("[API ERROR] Internship lookup failed:", lookupErr.message);
      return res.status(500).json({ error: "Database error while checking internship" });
    }
    if (!internship) {
      return res.status(404).json({ error: "Selected internship not found" });
    }

    db.run(
      `INSERT INTO applications (internship_id, applicant_name, email, cover_note)
       VALUES (?, ?, ?, ?)`,
      [parsedId, applicant_name.trim(), email.trim(), cover_note.trim()],
      function (insertErr) {
        if (insertErr) {
          console.error("[API ERROR] Application insert failed:", insertErr.message);
          return res.status(500).json({ error: "Failed to save application" });
        }
        res.status(201).json({
          message: "Application submitted successfully",
          applicationId: this.lastID
        });
      }
    );
  });
});

// Serve frontend from public/ if present, otherwise from project root
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(path.join(publicDir, "index.html"))) {
  app.use(express.static(publicDir));
} else {
  app.use(express.static(__dirname));
}

// Centralized error handler
app.use((err, req, res, next) => {
  console.error("[UNHANDLED ERROR]", err.stack || err.message);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});