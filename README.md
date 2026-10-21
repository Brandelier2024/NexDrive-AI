# DriveFinder AI (NexDrive AI) — Enterprise Media Locator

> **AI Agent & Developer System Manual**: Complete architectural specification, workflows, database schemas, API routes, and operational guidelines for **DriveFinder AI**.

---

## 1. Executive Summary & Purpose

**DriveFinder AI** is an enterprise Retrieval-Augmented Generation (RAG) system engineered to index, locate, and preview digital media (images, videos, graphics, photoshoots) stored across corporate Microsoft OneDrive / SharePoint drives and employee personal OneDrive accounts.

### Core Problems Solved
1. **Media Chaos & Deep Folder Trees:** Enterprise media files often sit buried inside nested folder structures with cryptic file names (`IMG_9482.RAW`, `DSC_0023.MOV`).
2. **Context-Blind Keyword Search:** Standard OneDrive search only indexes exact file names. DriveFinder AI uses **Gemini Vision** to inspect and caption visual content, generating semantic tags and searchable visual summaries.
3. **Parent-First Presentation:** Instead of presenting isolated orphan files, results are organized into **Folder Cards** showing parent folder paths, thumbnails, matching file counts, and direct OneDrive web URLs.
4. **Strict URL Fidelity:** Zero hallucinated links. Every folder link and file URL originates directly from verified Microsoft Graph delta metadata stored in Supabase.

---

## 2. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | [Next.js 16 (App Router)](https://nextjs.org), [React 19](https://react.dev), Vanilla CSS design system (dark mode, glassmorphism, responsive mobile bottom sheets) |
| **Authentication** | [NextAuth v5 (Auth.js beta)](https://authjs.dev) with Microsoft Entra ID (OIDC SSO) + Credentials Provider with Bcrypt & Email OTP |
| **Database & Vector Store** | [Supabase PostgreSQL](https://supabase.com) with `pgvector` (768-dimensional embeddings), Row-Level Security (RLS), and custom PL/pgSQL RPCs |
| **Primary Vision & Embeddings** | Google Gemini (`gemini-2.5-flash` for vision captioning & chat RAG, `models/gemini-embedding-001` or `text-embedding-004` for 768-dim vectors) |
| **Fallback LLM Provider** | [Groq Cloud](https://groq.com) running `meta-llama/llama-3.3-70b-versatile` with automatic zero-downtime failover on Gemini quota exhaustion |
| **Cloud Storage Ingestion** | Microsoft Graph API v1.0 (`/delta` sync for incremental indexing, thumbnail downloads, and personal drive enumeration) |
| **Email Delivery** | [Resend](https://resend.com) API or Corporate SMTP (Office 365) for OTP email verification |

---

## 3. Project Architecture & Directory Layout

```
ai chatbot rag/
├── scripts/
│   ├── find-drives.mjs          # CLI tool to list all Azure AD / Microsoft 365 drives
│   └── index-all.mjs            # High-speed initial drive crawler & embedding populator
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── [...nextauth]/route.ts  # NextAuth v5 auth endpoints
│   │   │   │   ├── send-otp/route.ts      # 6-digit email OTP dispatcher
│   │   │   │   └── signup/route.ts        # Account creation & OTP verification
│   │   │   ├── chat/
│   │   │   │   ├── route.ts               # Core RAG chat pipeline (dual-scope search)
│   │   │   │   └── history/route.ts       # Chat history pagination, deletion, and RPC summaries
│   │   │   ├── onedrive/
│   │   │   │   └── sync/route.ts          # Incremental delta crawler trigger & status
│   │   │   └── user/
│   │   │       ├── profile/route.ts       # Profile fetch & display metadata
│   │   │       └── delete-account/route.ts # User account & message deletion
│   │   ├── auth/
│   │   │   ├── signin/page.tsx            # Login with Microsoft SSO or company email
│   │   │   ├── signup/page.tsx            # Multi-step signup with OTP verification
│   │   │   └── error/page.tsx             # Auth error handler
│   │   ├── chat/
│   │   │   └── page.tsx                   # Protected chat entry point
│   │   ├── chat-ui.tsx                    # Main chat interface, sidebar, modals, folder cards
│   │   ├── globals.css                    # Unified design system & responsive styles
│   │   ├── layout.tsx                     # Root HTML & font configuration
│   │   └── page.tsx                       # Landing / redirect page
│   ├── lib/
│   │   ├── crawler/
│   │   │   ├── indexer.ts                 # Batch vector upsert into Supabase
│   │   │   ├── onedrive-crawler.ts        # Microsoft Graph delta sync crawler
│   │   │   └── vision-describer.ts        # Gemini Vision image analysis & tagging
│   │   ├── generation/
│   │   │   └── rag-chain.ts               # Prompt construction, URL guardrails, response generation
│   │   ├── graph/
│   │   │   ├── auth.ts                    # Azure AD OAuth2 client_credentials token generator
│   │   │   └── personal-drive.ts          # Employee personal OneDrive delta retrieval
│   │   ├── llm/
│   │   │   └── multi-provider.ts          # Gemini multi-key rotation + Groq Llama 3.3 fallback
│   │   ├── retrieval/
│   │   │   ├── embeddings.ts              # Gemini vector embedding generator (768 dims)
│   │   │   └── retriever.ts               # Multi-turn query rewriting, hybrid search & grouping
│   │   ├── auth.ts                        # NextAuth configuration & callbacks
│   │   ├── config.ts                      # Centralized environment configuration
│   │   ├── email.ts                       # Resend / SMTP OTP delivery & rate-limiting storage
│   │   ├── rate-limit.ts                  # IP spoofing-protected rate limiting
│   │   ├── supabase.ts                    # Server & client Supabase factories
│   │   └── types.ts                       # TypeScript interfaces and data models
│   └── middleware.ts                      # Route protection proxy
├── supabase-schema.sql                    # Full PostgreSQL schema, tables, RPCs, and indexes
├── supabase-rls.sql                       # Production Row Level Security hardening script
├── .env.example                           # Comprehensive template of required environment variables
└── package.json                           # Dependencies and scripts
```

---

## 4. Database Schema (Supabase PostgreSQL + pgvector)

### Core Tables

#### `onedrive_items` (Vector & Metadata Catalog)
Stores media assets and folders indexed from Microsoft OneDrive:
* `id` (`UUID`, PK)
* `item_id` (`TEXT`, UNIQUE): Microsoft Graph Item ID
* `record_type` (`TEXT`): `'folder'`, `'image'`, or `'video'`
* `name` (`TEXT`): File or folder name
* `file_web_url` (`TEXT`): Direct web link to file
* `parent_folder_id` (`TEXT`): Microsoft Graph ID of parent folder
* `parent_folder_name` (`TEXT`): Human-readable parent folder name
* `folder_path` (`TEXT`): Full directory path (e.g., `Marketing/Campaign2026/Posters`)
* `folder_web_url` (`TEXT`): Verified link to open the parent folder in OneDrive
* `thumbnail_url` (`TEXT`): Microsoft Graph thumbnail link
* `media_type` (`TEXT`): MIME type (e.g., `image/jpeg`, `video/mp4`)
* `visual_summary` (`TEXT`): AI-generated visual description
* `visual_tags` (`TEXT`): Comma-separated AI-extracted tags
* `last_modified` (`TIMESTAMPTZ`)
* `embedding` (`vector(768)`): Semantic embedding for similarity matching
* Indexes on: `item_id`, `record_type`, `folder_path`, and `embedding` (HNSW/IVFFlat).

#### `chat_messages` (Conversation Records)
* `id` (`UUID`, PK)
* `user_id` (`UUID`, FK -> `users.id`)
* `session_id` (`TEXT`): Identifier grouping messages in a conversation
* `role` (`TEXT`): `'user'` or `'assistant'`
* `content` (`TEXT`): Message markdown text
* `folder_cards` (`JSONB`): Attached structured folder card representations
* `created_at` (`TIMESTAMPTZ`)
* Index on: `(user_id, session_id)`.

#### `users` (User Accounts)
* `id` (`UUID`, PK)
* `email` (`TEXT`, UNIQUE): Normalized lowercase email
* `name` (`TEXT`)
* `password_hash` (`TEXT`): Bcrypt hash (null for SSO users)
* `avatar_url` (`TEXT`)
* `auth_provider` (`TEXT`): `'credentials'`, `'azure-ad'`, or `'microsoft-entra-id'`
* `created_at` (`TIMESTAMPTZ`)

#### `email_verifications` (OTP Lockout Table)
* `email` (`TEXT`, PK): User email
* `code` (`TEXT`): Stored 6-digit OTP code
* `expires_at` (`TIMESTAMPTZ`): Expiration timestamp
* `attempts` (`INTEGER`): Counter for failed attempts (max 5 before lockout)
* `created_at` (`TIMESTAMPTZ`)

#### `sync_state` (Delta Sync State)
* `id` (`TEXT`, PK): `'default'`
* `delta_link` (`TEXT`): Microsoft Graph opaque delta token for incremental sync
* `last_sync_at` (`TIMESTAMPTZ`)
* `items_synced` (`INTEGER`)

---

### Custom Database Functions (RPCs)

1. **`get_user_chat_sessions(p_user_id UUID, p_limit INT, p_offset INT)`**:
   Performs database-level aggregation (`GROUP BY session_id`), calculates exact session totals, finds the global active session ID, and paginates session summaries ordered by newest activity without hitting PostgREST 1,000-row limits.
2. **`get_chat_session_summaries(p_user_id UUID, p_session_ids TEXT[])`**:
   Window function query (`ROW_NUMBER()` and `COUNT(*)`) returning distinct titles (first user message) and latest messages for specific sessions.
3. **`match_onedrive_items(query_embedding vector(768), match_threshold float, match_count int)`**:
   Performs cosine distance vector search against `onedrive_items.embedding`.

---

## 5. Core Pipelines & Features

### A. Incremental OneDrive Ingestion & Vision Indexing
1. **Delta Querying:** `onedrive-crawler.ts` calls Microsoft Graph `/drives/{driveId}/root/delta`.
2. **Type Segregation:** Items are categorized into `folder`, `image`, or `video`.
3. **Vision Analysis (`vision-describer.ts`):**
   - For images, downloads the large thumbnail from Graph API.
   - Dispatches image to `gemini-2.5-flash` with a structured prompt requesting description, objects, scene, and tags.
4. **Embedding Generation:** Combines file name, folder path, summary, and tags into a unified semantic document. Generates a 768-dim embedding via `models/gemini-embedding-001`.
5. **Atomic Upsert:** Stored into Supabase `onedrive_items`. Saves the new `delta_link` to `sync_state`.

### B. Dual-Scope Hybrid Retrieval & RAG Generation
When a user asks a question in `/api/chat`:
1. **Query Rewriter:** Uses chat history to turn contextual queries (e.g., *"Show me the blue banners"* -> *"Show me posters for that"*) into standalone search queries.
2. **Dual-Scope Search:**
   - **Company Drive Search:** Queries Supabase `onedrive_items` using vector similarity + keyword fuzzy matching.
   - **Personal Drive Search:** Dynamically searches the authenticated user's personal Microsoft Graph drive via `personal-drive.ts`.
   - **Scope Selector:** Can be filtered to `'all'`, `'company'`, or `'personal'`.
3. **Parent-First Grouping:** Groups matching files by `folder_path`, highlighting the highest similarity score, folder thumbnail, and direct link.
4. **URL Fidelity Guardrail (`rag-chain.ts`):** The LLM prompt strictly forbids fabricating links. Answers only reference the exact `folder_web_url` and `file_web_url` passed in the retrieval context.

### C. Multi-LLM Failover Architecture (`multi-provider.ts`)
* **Gemini Multi-Key Pool:** Supports comma-separated keys in `GOOGLE_API_KEY` (e.g. `key1,key2,key3`). Rotates keys automatically upon HTTP 429 (quota exhaustion).
* **Groq Cloud Fallback:** If all Gemini keys are exhausted or unavailable, requests failover seamlessly to Groq's `meta-llama/llama-3.3-70b-versatile` with 0ms downtime. Supports multiple Groq keys in `GROQ_API_KEY`.

### D. Authentication & Security
* **NextAuth v5 OIDC SSO:** Authenticates corporate employees via Microsoft Entra ID (`microsoft-entra-id`). Automatically provisions users in Supabase.
* **Credentials & OTP Verification:** Employees can also register via company email. Issues a cryptographically secure 6-digit OTP code with a 10-minute expiry and 5-attempt brute-force lockout.
* **Domain Whitelisting:** Enforces `ALLOWED_EMAIL_DOMAIN` (e.g. `brandelier.in`) across both SSO and credentials registration.
* **Rate Limiting:** Prevents client IP forgery by prioritizing verified edge headers (`x-vercel-forwarded-for`, `cf-connecting-ip` with `cf-ray`).

---

## 6. API Route Reference

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/chat` | Main RAG chat endpoint with query rewriting, search, and answer streaming | Yes |
| `GET` | `/api/chat/history` | Paginated conversation sessions list (`?limit=50&offset=0`) or single session messages (`?sessionId=...`) | Yes |
| `DELETE` | `/api/chat/history` | Deletes a conversation session (`?sessionId=...`) or clears all (`?sessionId=all`) | Yes |
| `POST` | `/api/onedrive/sync` | Triggers background incremental delta sync with Microsoft Graph | Yes |
| `GET` | `/api/onedrive/sync` | Fetches current sync status (item counts, last sync date) | Yes |
| `POST` | `/api/auth/send-otp` | Sends 6-digit OTP to corporate email address | No |
| `POST` | `/api/auth/signup` | Verifies OTP code and creates credentials user account | No |
| `GET` | `/api/user/profile` | Returns current user profile data and authentication provider | Yes |
| `DELETE` | `/api/user/delete-account` | Deletes user account and associated chat messages | Yes |

---

## 7. Environment Variables Reference

Create a `.env.local` file in the project root with the following configuration:

```bash
# ─── Microsoft Azure AD / Graph API ───
AZURE_TENANT_ID=your_azure_tenant_id
AZURE_CLIENT_ID=your_azure_client_id
AZURE_CLIENT_SECRET=your_azure_client_secret
ONEDRIVE_DRIVE_ID=your_company_onedrive_drive_id

# ─── NextAuth v5 Configuration ───
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate_with_openssl_rand_base64_32

# ─── Company Domain Restriction ───
ALLOWED_EMAIL_DOMAIN=brandelier.in
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=brandelier.in

# ─── Supabase Configuration ───
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# ─── Primary LLM & Embeddings: Google Gemini ───
# Supports single key or comma-separated pool: key1,key2,key3
GOOGLE_API_KEY=your_gemini_api_key
ENABLE_VISION_CAPTIONING=true
VISION_MODEL=gemini-2.5-flash
EMBEDDING_MODEL=models/gemini-embedding-001
TOP_K_MATCHES=8
SIMILARITY_THRESHOLD=0.30

# ─── Secondary LLM: Groq Cloud Fallback (Meta Llama 3.3 70B) ───
# Supports single key or comma-separated pool: key1,key2
GROQ_API_KEY=your_groq_api_key

# ─── Email OTP Delivery (Resend or SMTP) ───
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=Brandelier AI <onboarding@resend.dev>

# Optional SMTP fallback:
# SMTP_HOST=smtp.office365.com
# SMTP_PORT=587
# SMTP_USER=notifications@brandelier.in
# SMTP_PASS=your_smtp_password
```

---

## 8. CLI Scripts & Operations

### A. Discover Available OneDrive Drives
To discover all drives (SharePoint document libraries and user drives) accessible to your Azure AD credentials:
```bash
node scripts/find-drives.mjs
```
Copy the desired drive ID into `ONEDRIVE_DRIVE_ID` in `.env.local`.

### B. Full Initial Drive Indexing
To perform a complete scan and indexing run of your OneDrive drive into Supabase:
```bash
node scripts/index-all.mjs
```
* Crawls all items starting from root `/delta`.
* Cleans paths and filters for `folder`, `image`, and `video`.
* Generates 768-dim embeddings and saves items in batches of 100 to Supabase.
* Saves `deltaLink` so future syncs are add-on only.

### C. Live Master Edits Sheet Ingestion (Zero-Hallucination)
To download and ingest the latest live master edit sheet (`BRANDELIER MASTER EDITS.xlsx`) from Microsoft Graph directly into Supabase:
```bash
node scripts/index-master-edits.mjs
```
* Queries Microsoft Graph authenticated endpoint with the live sharing URL token.
* Downloads live `.xlsx` workbook and parses all monthly sheets (`JULY`, `AUG`, `SEP 25`, `Oct 25`, `NOV 25`, `December 25`, `January 2026` through `Oct 2026`).
* Extracts Client, Project / Reel name, Assigned Editor, Shooter, Status, Shoot Date, Raw Footage link, and Final Edit Video link.
* Converts relative SharePoint paths (`../../../:f:/g/...`) to absolute clickable links.
* Automatically inherits shoot folder URLs for repeated project rows.
* Generates 768-dim embeddings and upserts records into `onedrive_items` in Supabase.
* On-demand sync can also be triggered via `POST /api/master-edits/sync`.

### D. Local Development & Production Build
```bash
# Run local dev server (default: http://localhost:3000)
npm run dev

# Run TypeScript type validation
npx tsc --noEmit

# Run ESLint validation
npm run lint

# Compile optimized production bundle
npm run build
```

---

## 9. Critical Rules for AI Agents Working on This Codebase

When writing code or refactoring this project, AI agents **MUST** follow these rules:

1. **NextAuth v5 Provider ID:** Always use provider ID `"microsoft-entra-id"`. Never use `"azure-ad"` for `signIn("microsoft-entra-id")`, as Auth.js v5 will reject unregistered providers.
2. **Microsoft Graph Personal Drive Access:** Personal OneDrive retrieval (`searchPersonalOneDrive`) relies on backend app-only `client_credentials` (`getGraphAccessToken`), querying `/users/{email}/drive/root/delta`. Do not attempt to use client-delegated user tokens for background crawlers.
3. **Database-Side RPC vs PostgREST Limits:** Never write unbounded message queries with `.limit(500)` or `.select("*")` across multi-session data. PostgREST enforces a 1,000-row maximum. Always use the `get_user_chat_sessions` and `get_chat_session_summaries` RPCs with session-level pagination (`limit`, `offset`), and maintain anchored fallbacks.
4. **URL Fidelity in Generation:** Never generate fake URLs or placeholders like `https://onedrive.live.com/file123`. All URLs rendered in the UI or chat response must strictly originate from `item.file_web_url` or `item.folder_web_url`.
5. **Atomic OTP Verification:** Always verify OTP attempts conditionally and atomically in Supabase (`email_verifications`) before verifying code equality to prevent parallel race conditions and bypass of brute-force lockouts.
6. **Next.js 16 / React 19 Lint Standards:** Avoid `setState` calls directly within `useEffect` bodies without dependency guards. Use Next.js `<Image />` where applicable or preserve responsive SVG/CSS assets.
