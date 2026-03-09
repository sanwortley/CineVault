const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const dbPath = process.env.NODE_ENV === 'development'
  ? path.join(__dirname, '../database/app.db')
  : path.join(app.getPath('userData'), 'app.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

// Promised-based wrapper
const database = {
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  exec: (sql) => {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  // Dummy prepare to keep some compatibility, but returns an object with promised methods
  prepare: (sql) => {
    return {
      run: (...params) => database.run(sql, params),
      get: (...params) => database.get(sql, params),
      all: (...params) => database.all(sql, params),
    };
  }
};

// Initialize tables
database.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_path TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT,
    file_path TEXT UNIQUE,
    file_size INTEGER,
    extension TEXT,
    detected_title TEXT,
    detected_year INTEGER,
    official_title TEXT,
    overview TEXT,
    spoiler_free_summary TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    genres TEXT,
    runtime INTEGER,
    director TEXT,
    rating REAL,
    identified_status TEXT DEFAULT 'pending', 
    needs_manual_confirmation INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    is_watched INTEGER DEFAULT 0,
    last_played DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT
  );
`).then(() => {
  console.log('[DB] Database initialized successfully');
});

module.exports = database;
