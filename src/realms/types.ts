/**
 * Realms: Distributed Kata Registry & Distribution
 *
 * Realms act as versioned kata repositories, enabling:
 * - Shared kata discovery across instances
 * - Version pinning and compatibility checking
 * - Dependency resolution (required skills)
 * - User-gated installation
 *
 * Central Realms (public) vs Local Realms (instance-specific).
 */

import type { CompiledKata } from "../kata/types.js";

/**
 * Metadata about a kata in a realm
 * Minimal info for discovery and compatibility checking
 */
export interface RealmKataMetadata {
  // Identity
  name: string; // "finance.audit"
  version: string; // "v2"
  source: "local" | "central" | "custom"; // where it came from

  // Requirements
  requiredSkills: string[]; // ["mail.search", "finance.extract"]
  minRoninVersion?: string; // "0.1.0" (optional version constraint)
  maxRoninVersion?: string; // "0.3.0" (optional version constraint)

  // Tags for discovery
  tags: string[]; // ["finance", "audit", "monthly"]
  category?: string; // "automation", "analytics", "integration"

  // Complexity indicator
  complexity: "simple" | "moderate" | "complex"; // Phase count estimate

  // Versioning
  releaseDate: number; // timestamp
  deprecated?: boolean;
  deprecationReason?: string;

  // Hashing for integrity
  sourceHash: string; // SHA256 of kata source code
  compiledHash: string; // SHA256 of compiled graph

  // Metadata about the kata
  description?: string; // One-line summary
  author?: string; // Who created it
  license?: string; // MIT, Apache, etc.
  documentation?: string; // URL or local path to guide

  // Installation
  installCount?: number; // How many times installed (popularity metric)
  lastModified: number; // timestamp
}

/**
 * A realm: a versioned collection of katas
 */
export interface Realm {
  id: string; // "central", "local", "user-custom"
  name: string;
  type: "central" | "local" | "custom";
  enabled: boolean;

  // Connection info (for central/custom realms)
  url?: string; // "https://realms.ronin.dev/v1"
  apiKey?: string; // Authentication token

  // Metadata
  description?: string;
  createdAt: number;
  lastSyncedAt?: number;

  // Caching strategy
  cacheStrategy?: "eager" | "lazy" | "none";
  cacheTtl?: number; // milliseconds (default: 1 hour)
}

/**
 * Realm index: all katas in a realm with metadata
 */
export interface RealmIndex {
  realmId: string;
  katas: Record<string, RealmKataMetadata[]>; // name -> [v1, v2, ...]
  indexedAt: number;
  totalKatas: number;
}

/**
 * Kata discovery result
 */
export interface KataDiscoveryResult {
  name: string;
  versions: RealmKataMetadata[];
  fromRealm: string;
  compatibleVersions: RealmKataMetadata[]; // filtered by minRoninVersion/maxRoninVersion
}

/**
 * Installation request (user approval)
 */
export interface KataInstallRequest {
  id: string;
  kataName: string;
  kataVersion: string;
  fromRealm: string;
  requestedAt: number;
  approvedAt?: number;
  approvedBy?: string;
  status: "pending" | "approved" | "rejected";
  reason?: string;
}

/**
 * Realms query result
 */
export interface RealmSearchResult {
  results: KataDiscoveryResult[];
  totalResults: number;
  query: string;
  searchedRealms: string[];
}

/**
 * Compatibility check result
 */
export interface CompatibilityReport {
  isCompatible: boolean;
  kataVersion: string;
  requiresMinVersion?: string;
  requiresMaxVersion?: string;
  currentRoninVersion: string;
  missingSkills?: string[];
  suggestions?: string[];
}

/**
 * Kata installation receipt (after user approval)
 */
export interface KataInstallReceipt {
  id: string;
  kataName: string;
  kataVersion: string;
  fromRealm: string;
  installedAt: number;
  checksumVerified: boolean;
  sourceHash: string;
  compiledHash: string;
  installedBy: string; // username or "system"
}
