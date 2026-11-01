# Graph Report - ai chatbot rag  (2026-11-01)

## Corpus Check
- 47 files · ~46,248 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .ico 2, (none) 1, .css 1)

## Summary
- 364 nodes · 824 edges · 15 communities (13 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `31e9b34b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- personal-drive.ts
- package.json
- createServerSupabaseClient
- indexer.ts
- chat-ui.tsx
- DriveFinder AI (NexDrive AI) — Enterprise Media Locator
- email.ts
- next
- compilerOptions
- multi-provider.ts
- index-all.mjs
- security.test.ts
- master-edits-sync.ts
- AGENTS.md
- { GET, POST }

## God Nodes (most connected - your core abstractions)
1. `createServerSupabaseClient()` - 31 edges
2. `auth` - 20 edges
3. `next` - 19 edges
4. `POST()` - 17 edges
5. `compilerOptions` - 16 edges
6. `ChatUI()` - 12 edges
7. `isGeminiConfigured()` - 12 edges
8. `searchPersonalOneDrive()` - 12 edges
9. `isCompanyEmail()` - 11 edges
10. `crawlOneDriveDelta()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `9. Critical Rules for AI Agents Working on This Codebase` --references--> `getGraphAccessToken()`  [INFERRED]
  README.md → src/lib/graph/auth.ts
- `9. Critical Rules for AI Agents Working on This Codebase` --references--> `searchPersonalOneDrive()`  [INFERRED]
  README.md → src/lib/graph/personal-drive.ts
- `POST()` --calls--> `isCompanyEmail()`  [EXTRACTED]
  src/app/api/auth/send-otp/route.ts → src/lib/config.ts
- `POST()` --calls--> `createServerSupabaseClient()`  [EXTRACTED]
  src/app/api/auth/send-otp/route.ts → src/lib/supabase.ts
- `POST()` --calls--> `isCompanyEmail()`  [EXTRACTED]
  src/app/api/auth/signup/route.ts → src/lib/config.ts

## Import Cycles
- None detected.

## Communities (15 total, 2 thin omitted)

### Community 0 - "personal-drive.ts"
Cohesion: 0.12
Nodes (33): 9. Critical Rules for AI Agents Working on This Codebase, isCompanyEmail(), getGraphAccessToken(), activeBackgroundSyncs, CacheEntry, CircuitBreakerStatus, cleanParentPath(), determineType() (+25 more)

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (46): eslintConfig, dependencies, @auth/core@^0.41.3, bcryptjs@^3.0.3, exceljs@^4.4.0, next@16.4.2, next-auth@^5.0.0-beta.32, nodemailer@^8.0.11 (+38 more)

### Community 2 - "createServerSupabaseClient"
Cohesion: 0.13
Nodes (28): DELETE(), GET(), maxDuration, POST(), GET(), maxDuration, POST(), DELETE() (+20 more)

### Community 3 - "indexer.ts"
Cohesion: 0.20
Nodes (16): cleanFolderPath(), crawlOneDriveDelta(), buildRecord(), CrawlResult, determineRecordType(), IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, describeThumbnail() (+8 more)

### Community 4 - "chat-ui.tsx"
Cohesion: 0.18
Nodes (17): AuthenticatedChat(), ChatPage(), ChatUI(), ChatUIProps, DEFAULT_TOPICS, emptySubscribe(), formatSessionDate(), generateUniqueId() (+9 more)

### Community 5 - "DriveFinder AI (NexDrive AI) — Enterprise Media Locator"
Cohesion: 0.08
Nodes (25): 1. Executive Summary & Purpose, 2. Technology Stack, 3. Project Architecture & Directory Layout, 4. Database Schema (Supabase PostgreSQL + pgvector), 5. Core Pipelines & Features, 6. API Route Reference, 7. Environment Variables Reference, 8. CLI Scripts & Operations (+17 more)

### Community 6 - "email.ts"
Cohesion: 0.15
Nodes (21): POST(), POST(), deleteOtp(), generateOtpCode(), getSupabaseClient(), OtpEntry, otpStore, safeTimingCompare() (+13 more)

### Community 7 - "next"
Cohesion: 0.09
Nodes (20): nextConfig, react@19.3.0, next, react, AuthErrorContent(), AuthErrorPage(), ERROR_MESSAGES, SignInContent() (+12 more)

### Community 8 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 9 - "multi-provider.ts"
Cohesion: 0.23
Nodes (13): @google/genai@^2.30.0, @google/genai, callGemini(), callGroq(), executeWithMultiProviderFallback(), geminiKeys, getActiveGeminiKey(), getHealthyKey() (+5 more)

### Community 10 - "index-all.mjs"
Cohesion: 0.10
Nodes (21): @supabase/supabase-js@^2.118.0, @supabase/supabase-js, env, envPath, cleanFolderPath(), determineRecordType(), env, envPath (+13 more)

### Community 11 - "security.test.ts"
Cohesion: 0.11
Nodes (34): POST(), saveChatMessage(), Message, extractMasterEditUrls(), formatRetrievedRecords(), generateDeterministicAnswer(), generateRagAnswer(), sanitizePromptText() (+26 more)

### Community 12 - "master-edits-sync.ts"
Cohesion: 0.38
Nodes (9): exceljs, extractCell(), extractHeaderCell(), extractRichText(), generateMasterEditId(), normalizeUrl(), MasterEditsSyncResult, safeIsoDate() (+1 more)

## Knowledge Gaps
- **1 isolated node(s):** `{ GET, POST }`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 121 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `package.json`, `createServerSupabaseClient`, `chat-ui.tsx`, `email.ts`, `security.test.ts`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **What connects `{ GET, POST }` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `personal-drive.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11942959001782531 - nodes in this community are weakly interconnected._
- **Why does `9. Critical Rules for AI Agents Working on This Codebase` connect `personal-drive.ts` to `DriveFinder AI (NexDrive AI) — Enterprise Media Locator`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05673758865248227 - nodes in this community are weakly interconnected._
- **Why does `DriveFinder AI (NexDrive AI) — Enterprise Media Locator` connect `DriveFinder AI (NexDrive AI) — Enterprise Media Locator` to `personal-drive.ts`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Should `createServerSupabaseClient` be split into smaller, more focused modules?**
  _Cohesion score 0.13002114164904863 - nodes in this community are weakly interconnected._