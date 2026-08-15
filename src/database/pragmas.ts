import type { Database } from "bun:sqlite";
import { logger } from "../utils/logger.js";

/**
 * Apply standard performance pragmas to a SQLite connection, and — once,
 * the first time this runs against a database that predates it — reclaim
 * any dead space already accumulated.
 *
 * WAL lets readers proceed during a write instead of blocking, which
 * matters here since many duties/routes can hit the same database
 * concurrently. auto_vacuum=FULL keeps the file size close to actual
 * content going forward (SQLite otherwise never returns freed pages from
 * deletes/updates to the OS — confirmed on the live app db: 216,930 pages
 * at 4096 bytes each, 215,695 of them (99.4%) sitting on the freelist,
 * an 888MB file for ~4MB of real data). Changing auto_vacuum only takes
 * effect on the next VACUUM, so a database that had it off needs exactly
 * one VACUUM to both shrink now and start self-maintaining after.
 */
export function applyPerformancePragmas(db: Database, label = "database"): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const autoVacuumRow = db.query("PRAGMA auto_vacuum;").all() as Array<{ auto_vacuum: number }>;
  const autoVacuum = autoVacuumRow[0]?.auto_vacuum ?? 0;
  if (autoVacuum === 0) {
    const before = (db.query("PRAGMA page_count;").all()[0] as { page_count: number } | undefined)?.page_count ?? 0;
    logger.info(`Enabling auto_vacuum and reclaiming dead space (one-time)`, { db: label, pagesBefore: before });
    const start = Date.now();
    db.exec("PRAGMA auto_vacuum = FULL;");
    db.exec("VACUUM;");
    const after = (db.query("PRAGMA page_count;").all()[0] as { page_count: number } | undefined)?.page_count ?? 0;
    logger.info(`Vacuum complete`, { db: label, pagesBefore: before, pagesAfter: after, durationMs: Date.now() - start });
  }
}
