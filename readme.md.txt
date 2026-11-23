# Internship Portal — Capstone

Full-stack internship listing and application portal built with Node.js, Express, SQLite, and a responsive HTML/CSS/JS frontend.

## Engineering Decisions
- **Relative API Base (`/api`):** Avoids hardcoded localhost ports so the frontend works both locally and when deployed.
- **Health & Logging:** Added request timing logs and `GET /health` with a SQLite connectivity check.
- **Security & Validation:** Enabled `helmet`, `cors`, `express-rate-limit`, parameterized SQLite queries, HTML escaping, and client + server validation.

## Run Locally
```bash
npm install
npm start