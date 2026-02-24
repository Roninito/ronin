/**
 * Realms Registry: Manages realms, kata discovery, and installation approvals
 */

import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";
import type {
  Realm,
  RealmKataMetadata,
  KataDiscoveryResult,
  KataInstallRequest,
  CompatibilityReport,
} from "./types.js";

const RONIN_VERSION = "0.7.0"; // Update as needed

export class RealmsRegistry {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS realms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('central', 'local', 'custom')),
        enabled BOOLEAN DEFAULT 1,
        url TEXT,
        api_key TEXT,
        description TEXT,
        created_at INTEGER NOT NULL,
        last_synced_at INTEGER,
        cache_strategy TEXT DEFAULT 'lazy',
        cache_ttl INTEGER DEFAULT 3600000
      );

      CREATE TABLE IF NOT EXISTS realm_kata_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        realm_id TEXT NOT NULL,
        kata_name TEXT NOT NULL,
        kata_version TEXT NOT NULL,
        source TEXT NOT NULL,
        required_skills TEXT NOT NULL,
        min_ronin_version TEXT,
        max_ronin_version TEXT,
        tags TEXT NOT NULL,
        category TEXT,
        complexity TEXT NOT NULL,
        release_date INTEGER NOT NULL,
        deprecated BOOLEAN DEFAULT 0,
        deprecation_reason TEXT,
        source_hash TEXT NOT NULL,
        compiled_hash TEXT NOT NULL,
        description TEXT,
        author TEXT,
        license TEXT,
        documentation TEXT,
        install_count INTEGER DEFAULT 0,
        last_modified INTEGER NOT NULL,
        FOREIGN KEY (realm_id) REFERENCES realms(id),
        UNIQUE (realm_id, kata_name, kata_version)
      );

      CREATE TABLE IF NOT EXISTS kata_install_requests (
        id TEXT PRIMARY KEY,
        kata_name TEXT NOT NULL,
        kata_version TEXT NOT NULL,
        from_realm TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        approved_at INTEGER,
        approved_by TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
        reason TEXT,
        FOREIGN KEY (from_realm) REFERENCES realms(id)
      );

      CREATE INDEX IF NOT EXISTS idx_realm_kata_index_realm_id 
        ON realm_kata_index(realm_id);
      CREATE INDEX IF NOT EXISTS idx_realm_kata_index_name 
        ON realm_kata_index(kata_name);
      CREATE INDEX IF NOT EXISTS idx_install_requests_status 
        ON kata_install_requests(status);
    `);
  }

  /**
   * Register a realm (central, local, or custom)
   */
  registerRealm(realm: Realm): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO realms (
        id, name, type, enabled, url, api_key, description,
        created_at, cache_strategy, cache_ttl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      realm.id,
      realm.name,
      realm.type,
      realm.enabled ? 1 : 0,
      realm.url || null,
      realm.apiKey || null,
      realm.description || null,
      realm.createdAt,
      realm.cacheStrategy || "lazy",
      realm.cacheTtl || 3600000
    );
  }

  /**
   * Get all enabled realms
   */
  getEnabledRealms(): Realm[] {
    const stmt = this.db.prepare(`
      SELECT * FROM realms WHERE enabled = 1 ORDER BY type DESC
    `);
    return stmt.all() as Realm[];
  }

  /**
   * Index katas from a realm (simulates syncing from realm server)
   */
  indexKatas(realmId: string, katas: RealmKataMetadata[]): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO realm_kata_index (
        realm_id, kata_name, kata_version, source, required_skills,
        min_ronin_version, max_ronin_version, tags, category, complexity,
        release_date, deprecated, deprecation_reason, source_hash,
        compiled_hash, description, author, license, documentation,
        install_count, last_modified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const kata of katas) {
      insertStmt.run(
        realmId,
        kata.name,
        kata.version,
        kata.source,
        JSON.stringify(kata.requiredSkills),
        kata.minRoninVersion || null,
        kata.maxRoninVersion || null,
        JSON.stringify(kata.tags),
        kata.category || null,
        kata.complexity,
        kata.releaseDate,
        kata.deprecated ? 1 : 0,
        kata.deprecationReason || null,
        kata.sourceHash,
        kata.compiledHash,
        kata.description || null,
        kata.author || null,
        kata.license || null,
        kata.documentation || null,
        kata.installCount || 0,
        kata.lastModified
      );
    }

    // Update realm sync time
    const updateStmt = this.db.prepare(
      `UPDATE realms SET last_synced_at = ? WHERE id = ?`
    );
    updateStmt.run(Date.now(), realmId);
  }

  /**
   * Discover katas by name or tags
   */
  discover(query: string, realmIds?: string[]): KataDiscoveryResult[] {
    const whereRealms = realmIds
      ? `AND realm_id IN (${realmIds.map(() => "?").join(",")})`
      : `AND realm_id IN (SELECT id FROM realms WHERE enabled = 1)`;

    const params = realmIds ? realmIds : [];

    const stmt = this.db.prepare(`
      SELECT DISTINCT realm_id, kata_name, kata_version, source,
        required_skills, min_ronin_version, max_ronin_version,
        tags, category, complexity, release_date, deprecated,
        deprecation_reason, source_hash, compiled_hash, description,
        author, license, documentation, install_count, last_modified
      FROM realm_kata_index
      WHERE (kata_name LIKE ? OR tags LIKE ?)
        ${whereRealms}
      ORDER BY kata_name, release_date DESC
    `);

    const searchTerm = `%${query}%`;
    const rows = stmt.all(searchTerm, searchTerm, ...params) as any[];

    const results: Map<string, KataDiscoveryResult> = new Map();

    for (const row of rows) {
      const key = row.kata_name;
      if (!results.has(key)) {
        results.set(key, {
          name: row.kata_name,
          versions: [],
          fromRealm: row.realm_id,
          compatibleVersions: [],
        });
      }

      const metadata: RealmKataMetadata = {
        name: row.kata_name,
        version: row.kata_version,
        source: row.source,
        requiredSkills: JSON.parse(row.required_skills),
        minRoninVersion: row.min_ronin_version,
        maxRoninVersion: row.max_ronin_version,
        tags: JSON.parse(row.tags),
        category: row.category,
        complexity: row.complexity,
        releaseDate: row.release_date,
        deprecated: row.deprecated === 1,
        deprecationReason: row.deprecation_reason,
        sourceHash: row.source_hash,
        compiledHash: row.compiled_hash,
        description: row.description,
        author: row.author,
        license: row.license,
        documentation: row.documentation,
        installCount: row.install_count,
        lastModified: row.last_modified,
      };

      const result = results.get(key)!;
      result.versions.push(metadata);

      // Check compatibility
      if (this.isCompatible(metadata)) {
        result.compatibleVersions.push(metadata);
      }
    }

    return Array.from(results.values());
  }

  /**
   * Get compatibility report for a kata version
   */
  checkCompatibility(metadata: RealmKataMetadata): CompatibilityReport {
    const isCompatible = this.isCompatible(metadata);
    const missingSkills = this.getMissingSkills(metadata.requiredSkills);

    return {
      isCompatible: isCompatible && missingSkills.length === 0,
      kataVersion: metadata.version,
      requiresMinVersion: metadata.minRoninVersion,
      requiresMaxVersion: metadata.maxRoninVersion,
      currentRoninVersion: RONIN_VERSION,
      missingSkills: missingSkills.length > 0 ? missingSkills : undefined,
      suggestions: isCompatible ? undefined : this.getSuggestions(metadata),
    };
  }

  /**
   * Request kata installation (creates pending request)
   */
  requestInstall(
    kataName: string,
    kataVersion: string,
    fromRealm: string
  ): KataInstallRequest {
    const id = randomUUID();
    const request: KataInstallRequest = {
      id,
      kataName,
      kataVersion,
      fromRealm,
      requestedAt: Date.now(),
      status: "pending",
    };

    const stmt = this.db.prepare(`
      INSERT INTO kata_install_requests (
        id, kata_name, kata_version, from_realm, requested_at, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      request.id,
      request.kataName,
      request.kataVersion,
      request.fromRealm,
      request.requestedAt,
      request.status
    );

    return request;
  }

  /**
   * Get pending install requests
   */
  getPendingRequests(): KataInstallRequest[] {
    const stmt = this.db.prepare(`
      SELECT * FROM kata_install_requests WHERE status = 'pending'
      ORDER BY requested_at DESC
    `);
    return stmt.all() as KataInstallRequest[];
  }

  /**
   * Approve an install request
   */
  approveInstall(requestId: string, approvedBy: string): void {
    const stmt = this.db.prepare(`
      UPDATE kata_install_requests
      SET status = 'approved', approved_at = ?, approved_by = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), approvedBy, requestId);
  }

  /**
   * Reject an install request
   */
  rejectInstall(requestId: string, reason: string): void {
    const stmt = this.db.prepare(`
      UPDATE kata_install_requests
      SET status = 'rejected', approved_at = ?, reason = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), reason, requestId);
  }

  private isCompatible(metadata: RealmKataMetadata): boolean {
    if (metadata.minRoninVersion) {
      if (this.compareVersions(RONIN_VERSION, metadata.minRoninVersion) < 0) {
        return false;
      }
    }
    if (metadata.maxRoninVersion) {
      if (this.compareVersions(RONIN_VERSION, metadata.maxRoninVersion) > 0) {
        return false;
      }
    }
    return true;
  }

  private getMissingSkills(required: string[]): string[] {
    // TODO: Check against registered skills (placeholder)
    return [];
  }

  private getSuggestions(metadata: RealmKataMetadata): string[] {
    const suggestions: string[] = [];
    if (metadata.minRoninVersion) {
      suggestions.push(
        `Upgrade Ronin to ${metadata.minRoninVersion} or higher`
      );
    }
    if (metadata.deprecated) {
      suggestions.push(
        `This kata is deprecated: ${metadata.deprecationReason || "No replacement provided"}`
      );
    }
    return suggestions;
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const a = parts1[i] || 0;
      const b = parts2[i] || 0;
      if (a !== b) return a - b;
    }
    return 0;
  }
}
