# Phase 7D: Realms Integration Guide

Realms enable distributed kata discovery, versioning, and installation across Ronin instances. This guide covers the architecture, APIs, and integration patterns.

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Realms Architecture](#realms-architecture)
4. [Kata Discovery](#kata-discovery)
5. [Installation Workflow](#installation-workflow)
6. [Dojo Agent](#dojo-agent)
7. [API Reference](#api-reference)
8. [Real-World Examples](#real-world-examples)
9. [Best Practices](#best-practices)

---

## Overview

**Problem:** How do teams share katas? How does discovery work? How do you avoid version conflicts?

**Solution:** Realms provide a registry layer where katas are versioned, indexed, and discovered. Installation is always user-gated (no auto-activation).

### Key Principles

- **Versioned**: Each kata has semantic versions (v1, v2, etc.)
- **Discoverable**: Search by name, tags, complexity, skills required
- **Audited**: Installation always requires user approval
- **Safe**: Compatibility checking (Ronin version, required skills)
- **Composable**: Local realms (instance-specific) + Central realms (shared)

### Architecture Layers

```
┌─────────────────────────────────┐
│   Dojo Agent (Proposals)        │ ← User interaction & approval
├─────────────────────────────────┤
│   Realms Registry (CRUD)        │ ← Discovery & compatibility
├─────────────────────────────────┤
│   Central Realms (API)          │ ← Shared kata library
│   Local Realms (Database)       │ ← Instance-specific katas
└─────────────────────────────────┘
```

---

## Core Concepts

### Realms

A **realm** is a collection of versioned katas:

```json
{
  "id": "central",
  "name": "Central Realms",
  "type": "central",
  "url": "https://realms.ronin.dev/v1",
  "enabled": true
}
```

Types:

- **central**: Public realms (shared across all Ronin instances)
- **local**: Instance-specific realms (this Ronin's own katas)
- **custom**: Third-party realms (team, org, etc.)

### RealmKataMetadata

Minimal metadata indexed in each realm:

```typescript
interface RealmKataMetadata {
  name: string; // "finance.audit"
  version: string; // "v2"
  requiredSkills: string[]; // ["mail.search", "finance.extract"]
  minRoninVersion?: string; // "0.1.0"
  maxRoninVersion?: string; // "0.3.0"
  tags: string[]; // ["finance", "audit", "monthly"]
  complexity: "simple" | "moderate" | "complex";
  sourceHash: string; // SHA256 for integrity
  compiledHash: string; // SHA256 of compiled graph
  deprecated?: boolean;
  installCount?: number; // Popularity metric
}
```

**Why metadata, not full source?**
- Fast discovery (no downloading)
- Compatibility checking before install
- Popularity metrics
- Integrity verification via hashes

### Installation Workflow

```
┌──────────────────────────────────────────────┐
│  User says: "I need to track subscriptions"  │
└──────────────────────────────────────────────┘
                     ↓
        [Dojo discovers matching katas]
                     ↓
     ┌────────────────────────────────┐
     │   Proposal: finance.audit v2   │
     │   Required skills: mail.search │
     │   Complexity: moderate         │
     └────────────────────────────────┘
                     ↓
         [User approval dialog]
                     ↓
         ┌──────────────────────┐
         │ Download + Compile   │
         │ Verify checksums     │
         │ Register locally     │
         └──────────────────────┘
                     ↓
     ✅ Kata ready for use via contracts
```

---

## Realms Architecture

### RealmsRegistry (Database Layer)

The `RealmsRegistry` manages:
- Realm registration and sync
- Kata indexing
- Discovery queries
- Installation approval workflow

```typescript
// Register a realm
registry.registerRealm({
  id: "central",
  name: "Central Realms",
  type: "central",
  url: "https://realms.ronin.dev/v1",
  enabled: true,
  createdAt: Date.now(),
});

// Index katas from realm
registry.indexKatas("central", [
  {
    name: "finance.audit",
    version: "v2",
    requiredSkills: ["mail.search"],
    tags: ["finance", "audit"],
    complexity: "moderate",
    sourceHash: "abc123...",
    compiledHash: "def456...",
    releaseDate: Date.now(),
    lastModified: Date.now(),
  },
  // ... more katas
]);

// Discover by query
const results = registry.discover("finance", ["central"]);
// returns KataDiscoveryResult[]

// Check compatibility
const report = registry.checkCompatibility(metadata);
// {
//   isCompatible: true,
//   missingSkills: [],
//   suggestions: []
// }
```

### Database Schema

```sql
-- Realms
CREATE TABLE realms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled BOOLEAN,
  url TEXT,
  api_key TEXT,
  created_at INTEGER,
  last_synced_at INTEGER,
  cache_strategy TEXT,
  cache_ttl INTEGER
);

-- Kata metadata index
CREATE TABLE realm_kata_index (
  realm_id TEXT,
  kata_name TEXT,
  kata_version TEXT,
  source TEXT,
  required_skills TEXT, -- JSON array
  min_ronin_version TEXT,
  max_ronin_version TEXT,
  tags TEXT, -- JSON array
  category TEXT,
  complexity TEXT,
  source_hash TEXT,
  compiled_hash TEXT,
  description TEXT,
  install_count INTEGER,
  last_modified INTEGER,
  UNIQUE (realm_id, kata_name, kata_version)
);

-- Installation requests (audit trail)
CREATE TABLE kata_install_requests (
  id TEXT PRIMARY KEY,
  kata_name TEXT,
  kata_version TEXT,
  from_realm TEXT,
  requested_at INTEGER,
  approved_at INTEGER,
  approved_by TEXT,
  status TEXT, -- 'pending', 'approved', 'rejected'
  reason TEXT
);
```

---

## Kata Discovery

### Discovery Query

```typescript
const results = registry.discover("audit", ["central", "local"]);
// Returns katas matching 'audit' in name or tags
```

Result structure:

```typescript
interface KataDiscoveryResult {
  name: string; // "finance.audit"
  versions: RealmKataMetadata[]; // all versions
  fromRealm: string; // "central"
  compatibleVersions: RealmKataMetadata[]; // filtered by Ronin version
}
```

### Search by Tags

```typescript
const results = registry.discover("finance automation");
// Searches: kata_name LIKE '%finance%' OR tags LIKE '%automation%'
```

### Compatibility Checking

```typescript
const report = registry.checkCompatibility(metadata);

if (!report.isCompatible) {
  console.log(report.suggestions);
  // ["Upgrade Ronin to 0.2.0 or higher"]
}

if (report.missingSkills && report.missingSkills.length > 0) {
  console.log("Install skills first:", report.missingSkills);
}
```

### Version Selection

**Best Practice:** Always ask user which version to install (show all compatible versions).

```typescript
const discovered = registry.discover("audit", ["central"]);
const kata = discovered[0]; // "finance.audit"

console.log("Available versions:");
kata.compatibleVersions.forEach((v) => {
  console.log(`  ${v.version} - ${v.description}`);
  console.log(`    Tags: ${v.tags.join(", ")}`);
  console.log(`    Complexity: ${v.complexity}`);
});

// User selects v2, requests install
registry.requestInstall("finance.audit", "v2", "central");
```

---

## Installation Workflow

### Step 1: Request Installation

```typescript
const request = registry.requestInstall("finance.audit", "v2", "central");
// Returns: {
//   id: "uuid",
//   kataName: "finance.audit",
//   kataVersion: "v2",
//   fromRealm: "central",
//   requestedAt: 1708800000,
//   status: "pending"
// }

// Emit event for UI to show approval
api.events.emit("kata.install_proposed", {
  proposalId: request.id,
  kataName: "finance.audit",
  versions: [...],
}, "dojo");
```

### Step 2: User Approval

```typescript
// UI: User clicks "Approve"
api.events.emit("kata.user_approved", {
  proposalId: request.id,
  approvedBy: "user123",
}, "dojo");
```

### Step 3: Dojo Agent Handles Installation

```typescript
// Dojo agent listens to kata.user_approved
// 1. Download kata source from realm
// 2. Verify checksum against metadata
// 3. Compile kata (KataCompiler)
// 4. Register locally (KataRegistry)
// 5. Emit kata.installed event

api.events.emit(
  "kata.installed",
  {
    kataName: "finance.audit",
    kataVersion: "v2",
    fromRealm: "central",
  },
  "dojo"
);
```

### Step 4: Contract Registration (Optional)

User can now create contracts for installed kata:

```
contract daily.finance.audit v1
trigger cron 0 3 * * *
run kata finance.audit v2
```

---

## Dojo Agent

**Dojo** = training ground for new katas (vetting + approval before activation).

### Responsibilities

1. **Listen for missing capabilities**

```typescript
api.events.on("capability.missing", async (payload) => {
  // Search realms for matching katas
  // Propose best match to user
});
```

2. **Search realms**

```typescript
const results = registry.discover(query, realmIds);
// AI selects best match + analyzes skills needed
```

3. **Propose to user**

```typescript
// Two types of proposals:

// A) Install from realm
api.events.emit("kata.install_proposed", {
  proposalId: uuid,
  kataName: "finance.audit",
  versions: [...],
  fromRealm: "central",
}, "dojo");

// B) Create new kata
api.events.emit("kata.creation_proposed", {
  proposalId: uuid,
  kataName: "finance.track_subscriptions",
  phases: [...],
  requiredSkills: [...],
}, "dojo");
```

4. **Handle approval**

```typescript
api.events.on("kata.user_approved", async (payload) => {
  // Install from realm OR create new kata
  // Emit kata.installed or kata.created
});
```

### Integration Example

```typescript
// User: "I need to track all recurring subscriptions"
// ↓
// Dojo hears capability.missing
// ↓
// Dojo searches realms for "subscription"
// ↓
// Finds: finance.subscriptions v1 (requires mail.search skill)
// ↓
// Proposes to user with details
// ↓
// User approves
// ↓
// Dojo downloads, verifies, compiles, registers
// ↓
// User can now create contracts for finance.subscriptions
```

---

## API Reference

### RealmsRegistry

#### registerRealm(realm: Realm)

Register a new realm (central, local, or custom).

```typescript
registry.registerRealm({
  id: "my-custom",
  name: "My Custom Realms",
  type: "custom",
  url: "https://my-realms.example.com/v1",
  apiKey: "token123",
  enabled: true,
  createdAt: Date.now(),
});
```

#### getEnabledRealms(): Realm[]

Get all enabled realms (sorted by type: custom, central, local).

#### indexKatas(realmId: string, katas: RealmKataMetadata[])

Index katas from a realm (simulates sync from realm server).

#### discover(query: string, realmIds?: string[]): KataDiscoveryResult[]

Search realms by name or tags. Returns matching katas + versions.

#### checkCompatibility(metadata: RealmKataMetadata): CompatibilityReport

Check if kata is compatible with current Ronin version and available skills.

#### requestInstall(kataName, kataVersion, fromRealm): KataInstallRequest

Create a pending installation request.

#### getPendingRequests(): KataInstallRequest[]

Get all pending install requests.

#### approveInstall(requestId, approvedBy)

Approve a pending install request.

#### rejectInstall(requestId, reason)

Reject a pending install request.

---

## Real-World Examples

### Example 1: Discover & Install Kata

```typescript
// User searches for "audit"
const results = registry.discover("audit");
// [KataDiscoveryResult: finance.audit, ...]

// User selects finance.audit
const kata = results[0];
console.log(`Latest version: ${kata.versions[0].version}`);
console.log(`Complexity: ${kata.versions[0].complexity}`);
console.log(`Required skills: ${kata.versions[0].requiredSkills}`);

// Check compatibility
const report = registry.checkCompatibility(kata.versions[0]);
if (report.isCompatible) {
  console.log("✓ Compatible with this Ronin version");
} else {
  console.log("✗ Incompatible:", report.suggestions);
  return;
}

// Request install
const request = registry.requestInstall(
  kata.name,
  kata.versions[0].version,
  kata.fromRealm
);

// Emit proposal event
api.events.emit("kata.install_proposed", {
  proposalId: request.id,
  kataName: kata.name,
  versions: kata.versions,
  fromRealm: kata.fromRealm,
}, "dojo");

// Wait for user approval...
// [User approves]

// Dojo installs
registry.approveInstall(request.id, "user123");
// ... download + compile + register
```

### Example 2: Dojo Proposing New Kata

```typescript
// User: "I need to sync Slack updates to Discord"
// [capability.missing event]

// Dojo searches realms for "slack discord sync"
const results = registry.discover("slack discord");

if (results.length === 0) {
  // No existing kata matches -> propose creation

  const proposal = await ai.complete(`
    Create a kata for syncing Slack to Discord.
    Return JSON with phases, required skills, etc.
  `);

  api.events.emit("kata.creation_proposed", {
    proposalId: uuid,
    kataName: "integration.slack_to_discord",
    phases: proposal.phases,
    requiredSkills: proposal.requiredSkills,
    tags: proposal.tags,
  }, "dojo");
}
```

### Example 3: Checking Realm Stats

```typescript
// Get all realms and their kata counts
const realms = registry.getEnabledRealms();

for (const realm of realms) {
  const results = registry.discover("*"); // all katas
  console.log(`${realm.name}: ${results.length} katas`);

  for (const result of results) {
    console.log(
      `  ${result.name}: ${result.versions.length} versions, ` +
      `${result.versions[0].installCount || 0} installs`
    );
  }
}
```

---

## Best Practices

### 1. Always Show All Compatible Versions

```typescript
const discovered = registry.discover("audit");
const kata = discovered[0];

// DON'T just install latest version
// DO show user all compatible versions
console.log("Compatible versions:");
kata.compatibleVersions.forEach((v) => {
  console.log(`  ${v.version} (${v.releaseDate})`);
});
```

### 2. Check Missing Skills Before Install

```typescript
const report = registry.checkCompatibility(metadata);
if (report.missingSkills && report.missingSkills.length > 0) {
  console.log("Cannot install: missing required skills");
  console.log("Install these first:", report.missingSkills);
  return;
}
```

### 3. Verify Checksums After Download

```typescript
// After downloading kata source from realm:
const sourceHash = crypto.sha256(source);
const metadata = ...; // from realm index

if (sourceHash !== metadata.sourceHash) {
  throw new Error("Checksum mismatch! Possible tampering or corruption.");
}

// Then compile and verify compiled hash
const compiled = compiler.compile(ast);
const compiledHash = crypto.sha256(JSON.stringify(compiled));

if (compiledHash !== metadata.compiledHash) {
  throw new Error("Compiled hash mismatch!");
}
```

### 4. Track Installation Receipts

```typescript
// After successful install, store receipt
const receipt: KataInstallReceipt = {
  id: uuid,
  kataName: "finance.audit",
  kataVersion: "v2",
  fromRealm: "central",
  installedAt: Date.now(),
  checksumVerified: true,
  sourceHash: metadata.sourceHash,
  compiledHash: metadata.compiledHash,
  installedBy: "user123",
};

// Store in database for audit trail
db.query(
  `INSERT INTO kata_install_receipts (...) VALUES (...)`,
  receipt
);
```

### 5. Regular Realm Sync

```typescript
// Daily sync of central realms
static schedule = "0 6 * * *"; // 6 AM daily

async execute() {
  const realms = registry.getEnabledRealms()
    .filter(r => r.type === "central");

  for (const realm of realms) {
    try {
      const newIndex = await fetchRealmIndex(realm.url);
      registry.indexKatas(realm.id, newIndex.katas);
    } catch (error) {
      console.error(`Failed to sync ${realm.id}:`, error);
    }
  }
}
```

---

## Next Steps

**Phase 7D Complete:** Realms infrastructure is ready!

**Future Phases:**

- **Phase 8:** Parallel child spawning (multiple children executing concurrently)
- **Phase 9:** Conditional branching in Kata DSL (if/else, switch)
- **Phase 10:** Event-driven contracts (user requests, webhooks, external triggers)

---

*Phase 7 Complete: Kata DSL + Task Engine + Contracts + Child Tasks + Realms*
