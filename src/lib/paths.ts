import path from "node:path";

/**
 * The one directory everything Genesis puts on a volume lives under.
 *
 * `GENESIS_DATA_DIR` is the operator's answer to "where does this deployment
 * keep its data" — the SQLite database and its WAL, and the signed documents a
 * filing is made from. It is one setting rather than two because they are one
 * thing: a business's record and the signed Form SS-4 it was filed from are the
 * same evidence, and a backup that takes one and not the other has taken
 * neither.
 *
 * The reason this module exists at all is that the two halves disagreed. The
 * document store read `GENESIS_DATA_DIR`; the database ignored it and always
 * opened `process.cwd()/data`. On the shipped compose the two coincide, because
 * the working directory is `/app` and `/app/data` is the volume — so nothing was
 * visibly wrong. Anywhere else (`GENESIS_DATA_DIR=/mnt/genesis`, or a process
 * whose cwd is not the app directory) the deployment would put filings on the
 * mounted volume and the *database* somewhere nobody backed up, silently. A
 * split like that is only ever discovered by losing a record.
 *
 * Empty or whitespace counts as unset, so a compose file passing an empty
 * variable falls back to the default rather than to the filesystem root.
 */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.GENESIS_DATA_DIR?.trim();
  return configured || path.join(process.cwd(), "data");
}

/** The SQLite database, and the WAL and SHM files SQLite keeps beside it. */
export function databasePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(dataDir(env), "genesis.db");
}

/** The schema and migrations that are applied to it, which ship with the code. */
export function schemaPath(): string {
  return path.join(process.cwd(), "scripts", "schema.sql");
}

export function migrationsDir(): string {
  return path.join(process.cwd(), "scripts", "migrations");
}
