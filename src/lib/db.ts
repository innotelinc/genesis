import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { dataDir, databasePath, migrationsDir, schemaPath } from "./paths";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  // The database goes where the deployment says its data goes, not where the
  // process happens to be. `paths.ts` records what that distinction cost.
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(databasePath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  const schema = schemaPath();
  if (fs.existsSync(schema)) {
    _db.exec(fs.readFileSync(schema, "utf8"));
  }

  const migrations = migrationsDir();
  if (fs.existsSync(migrations)) {
    const files = fs
      .readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      try {
        _db.exec(fs.readFileSync(path.join(migrations, file), "utf8"));
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
