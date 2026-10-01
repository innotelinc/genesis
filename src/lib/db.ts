import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _db = new Database(path.join(dataDir, "genesis.db"));
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "scripts", "schema.sql");
  if (fs.existsSync(schemaPath)) {
    _db.exec(fs.readFileSync(schemaPath, "utf8"));
  }

  const migrationsDir = path.join(process.cwd(), "scripts", "migrations");
  if (fs.existsSync(migrationsDir)) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      try {
        _db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
      } catch {
        // already applied
      }
    }
  }

  return _db;
}

const db = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const realDb = getDb();
    const value = Reflect.get(realDb, prop, realDb);
    return typeof value === "function" ? value.bind(realDb) : value;
  },
});

export default db;
