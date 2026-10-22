import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/lib/auth";

async function HeaderActions() {
  await connection();
  const session = await auth();
  const isLoggedIn = !!session?.user;

  if (isLoggedIn) {
    return (
      <>
        <span className="landing-user-badge">
          {session.user?.name || session.user?.email}
        </span>
        <Link href="/chat" className="landing-btn-primary">
          Launch Search
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </>
    );
  }

  return <DefaultHeaderActions />;
}

function DefaultHeaderActions() {
  return (
    <>
      <Link href="/auth/signin" className="landing-nav-link">
        Sign In
      </Link>
      <Link href="/auth/signup" className="landing-btn-primary">
        Get Started
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </Link>
    </>
  );
}

export default function HomePage() {

  return (
    <div className="landing-page">
      {/* ───────────────────────────────────────────────
          1. Header Navigation
          ─────────────────────────────────────────────── */}
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <Link href="/" className="landing-brand">
            <div className="landing-logo-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="3" />
                <path d="m14.5 15.5 2 2" />
              </svg>
            </div>
            <div className="landing-brand-text">
              <span className="landing-brand-name">DriveFinder</span>
              <span className="landing-brand-badge">AI</span>
            </div>
          </Link>

          <nav className="landing-nav">
            <a href="#features" className="landing-nav-link">Capabilities</a>
            <a href="#how-it-works" className="landing-nav-link">How It Works</a>
            <a href="#security" className="landing-nav-link">Security</a>
          </nav>

          <div className="landing-header-actions">
            <Suspense fallback={<DefaultHeaderActions />}>
              <HeaderActions />
            </Suspense>
          </div>
        </div>
      </header>

      {/* ───────────────────────────────────────────────
          2. Hero Section
          ─────────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-container landing-hero-content">
          <div className="landing-pill">
            <span className="landing-pill-dot" />
            Brandelier Media Works · Enterprise File & Media Discovery
          </div>

          <h1 className="landing-title">
            Find company assets and folders in seconds.
          </h1>

          <p className="landing-subtitle">
            An intelligent enterprise search tool indexing over 19,000 OneDrive and SharePoint files.
            Locate video drafts, raw footage, photo shoots, and project folders using simple, natural language.
          </p>

          <div className="landing-cta-group">
            <Link href="/chat" className="landing-btn-hero-primary">
              Open Search App
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link href="/auth/signup" className="landing-btn-hero-secondary">
              Create Account
            </Link>
          </div>

          {/* Quick Stats Strip */}
          <div className="landing-stats-grid">
            <div className="landing-stat-item">
              <span className="landing-stat-value">19,200+</span>
              <span className="landing-stat-label">Indexed Files & Media</span>
            </div>
            <div className="landing-stat-item">
              <span className="landing-stat-value">~1.0s</span>
              <span className="landing-stat-label">Search Response Time</span>
            </div>
            <div className="landing-stat-item">
              <span className="landing-stat-value">100%</span>
              <span className="landing-stat-label">Direct SharePoint Links</span>
            </div>
            <div className="landing-stat-item">
              <span className="landing-stat-value">Read-Only</span>
              <span className="landing-stat-label">Zero File Mutation Risk</span>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────
          3. Live Search Preview
          ─────────────────────────────────────────────── */}
      <section className="landing-preview-section">
        <div className="landing-container">
          <div className="landing-preview-card">
            <div className="landing-preview-header">
              <div className="landing-window-dots">
                <span className="landing-dot" />
                <span className="landing-dot" />
                <span className="landing-dot" />
              </div>
              <span className="landing-preview-title">DriveFinder Search Console</span>
            </div>

            <div className="landing-search-mockup">
              <div className="landing-mock-input">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span className="landing-mock-query">Show me Barjockey video files</span>
              </div>
            </div>

            <div className="landing-mock-results">
              <div className="landing-mock-card">
                <div className="landing-mock-card-top">
                  <div className="landing-mock-folder-info">
                    <div className="landing-folder-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <div>
                      <div className="landing-mock-folder-name">Team Files/Shakti Kale/Brands/BARJOCKEY</div>
                      <div className="landing-mock-folder-sub">Parent project folder directory in SharePoint</div>
                    </div>
                  </div>
                  <span className="landing-mock-link-tag">Verified OneDrive Link</span>
                </div>

                <div className="landing-mock-files-list">
                  <div className="landing-mock-file-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span className="landing-mock-file-name">Barjockey Eak Rum Draft 2 .mp4</span>
                    <span className="landing-mock-file-meta">Direct media link</span>
                  </div>
                  <div className="landing-mock-file-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span className="landing-mock-file-name">C1976.MP4</span>
                    <span className="landing-mock-file-meta">Masterclass video asset</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────
          4. Capabilities Section
          ─────────────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="landing-section-tag">CAPABILITIES</span>
            <h2 className="landing-section-title">Designed for how media teams work.</h2>
            <p className="landing-section-desc">
              Stop clicking through nested directories. Ask for what you need and get the direct link immediately.
            </p>
          </div>

          <div className="landing-features-grid">
            {/* Feature 1 */}
            <div className="landing-feature-card">
              <div className="landing-feature-icon-box">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className="landing-feature-title">Natural Language Queries</h3>
              <p className="landing-feature-text">
                Search naturally by brand, campaign name, video format, or team member. The search engine resolves variations and transliterations without needing exact file syntax.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="landing-feature-card">
              <div className="landing-feature-icon-box">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </div>
              <h3 className="landing-feature-title">Direct SharePoint Links</h3>
              <p className="landing-feature-text">
                Every result produces a direct, verified SharePoint or OneDrive URL. Open the folder in your browser or jump straight into video files with a single click.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="landing-feature-card">
              <div className="landing-feature-icon-box">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3 className="landing-feature-title">Temporal & Date Filtering</h3>
              <p className="landing-feature-text">
                Filter assets by specific upload months (e.g. October 2026, September shoots) or request the most recent project uploads across company drives.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────
          5. How It Works
          ─────────────────────────────────────────────── */}
      <section id="how-it-works" className="landing-section landing-section-alt">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="landing-section-tag">WORKFLOW</span>
            <h2 className="landing-section-title">Three steps to your asset.</h2>
            <p className="landing-section-desc">
              Fast, deterministic retrieval powered by Microsoft Graph indexing and Postgres search.
            </p>
          </div>

          <div className="landing-steps-grid">
            <div className="landing-step-card">
              <div className="landing-step-number">01</div>
              <h3 className="landing-step-title">Enter your query</h3>
              <p className="landing-step-text">
                Type what you are looking for in plain text (e.g. &ldquo;Find Barjockey draft videos&rdquo; or &ldquo;Files uploaded in October&rdquo;).
              </p>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-number">02</div>
              <h3 className="landing-step-title">Instant matching</h3>
              <p className="landing-step-text">
                DriveFinder scans 19,000+ indexed items using multi-word matching, date indexing, and folder hierarchies in under a second.
              </p>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-number">03</div>
              <h3 className="landing-step-title">Direct access</h3>
              <p className="landing-step-text">
                Click the verified OneDrive link to browse the folder or open individual media assets directly in SharePoint.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────
          6. Security Section
          ─────────────────────────────────────────────── */}
      <section id="security" className="landing-section">
        <div className="landing-container">
          <div className="landing-security-box">
            <div className="landing-security-content">
              <span className="landing-section-tag">SECURITY & INTEGRITY</span>
              <h2 className="landing-security-title">Strict read-only data architecture.</h2>
              <p className="landing-security-text">
                DriveFinder is built exclusively for internal company use with defense-in-depth security standards.
              </p>

              <div className="landing-security-list">
                <div className="landing-security-item">
                  <div className="landing-check-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <strong>Zero File Deletion or Modification:</strong>
                    <span> The Microsoft Graph integration possesses read-only crawl privileges. Chat prompts cannot alter or delete SharePoint content.</span>
                  </div>
                </div>

                <div className="landing-security-item">
                  <div className="landing-check-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <strong>Row Level Security (RLS):</strong>
                    <span> Supabase tables are secured with granular policies. User histories and verification records cannot be queried or tampered with externally.</span>
                  </div>
                </div>

                <div className="landing-security-item">
                  <div className="landing-check-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <strong>Company Domain Restriction:</strong>
                    <span> Access is strictly gated to verified company employee email addresses and Microsoft 365 single sign-on.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────
          7. Bottom Call to Action
          ─────────────────────────────────────────────── */}
      <section className="landing-cta-banner">
        <div className="landing-container landing-cta-inner">
          <h2 className="landing-cta-title">Ready to locate your company files?</h2>
          <p className="landing-cta-subtitle">
            Access the complete Brandelier Media Works repository through natural language search.
          </p>
          <div className="landing-cta-actions">
            <Link href="/chat" className="landing-btn-hero-primary">
              Open DriveFinder App
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────
          8. Footer
          ─────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-footer-brand">
            <div className="landing-footer-logo">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="3" />
                <path d="m14.5 15.5 2 2" />
              </svg>
              <span>DriveFinder AI</span>
            </div>
            <p className="landing-footer-copy">
              Internal enterprise media locator. Developed for Brandelier Media Works LLP.
            </p>
          </div>

          <div className="landing-footer-links">
            <Link href="/chat" className="landing-footer-link">
              Search Console
            </Link>
            <Link href="/auth/signin" className="landing-footer-link">
              Sign In
            </Link>
            <Link href="/auth/signup" className="landing-footer-link">
              Register Account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
