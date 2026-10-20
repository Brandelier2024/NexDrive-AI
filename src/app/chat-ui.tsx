"use client";

import { useState, useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { FolderCard, ChatResponse } from "@/lib/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  folder_cards?: FolderCard[];
  timestamp: string;
}

interface ChatUIProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

const SUGGESTED_QUERIES = [
  {
    title: "Diwali Campaign Videos",
    desc: "Find final promotional reels and festive videos",
    query: "Find the final Diwali promotional videos and reels",
  },
  {
    title: "Company Brand Logos",
    desc: "Locate primary logos and vector master files",
    query: "Where are the official brand logos and master vector files?",
  },
  {
    title: "Product Launch Reels",
    desc: "Vertical 9:16 videos and drone footage",
    query: "Show me vertical videos and reels for product launches",
  },
  {
    title: "Team & Event Photos",
    desc: "Office photoshoot and Annual Gala photos",
    query: "Where are the Annual Gala and office team photos?",
  },
];

export default function ChatUI({ user }: ChatUIProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    total_items: number;
    mode: string;
    folders_count: number;
    media_count: number;
    last_sync_at?: string | null;
    has_delta_link?: boolean;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Load sync status on mount
  useEffect(() => {
    fetchSyncStatus();
  }, []);

  const fetchSyncStatus = async () => {
    try {
      const res = await fetch("/api/onedrive/sync");
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch {
      // ignore
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncToast("Checking for newly added or modified assets (incremental delta)...");
    try {
      const res = await fetch("/api/onedrive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.success) {
        if (data.items_processed > 0) {
          setSyncToast(
            `✅ Add-on sync complete! +${data.items_processed} new/updated assets indexed in ${(data.duration_ms / 1000).toFixed(1)}s.`
          );
        } else {
          setSyncToast(
            `✅ OneDrive is fully up to date! 0 new changes detected in ${(data.duration_ms / 1000).toFixed(2)}s.`
          );
        }
        fetchSyncStatus();
      } else {
        setSyncToast(`Sync notice: ${data.error || "Ready"}`);
      }
    } catch {
      setSyncToast("Sync failed. Check server console.");
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncToast(null), 5000);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const queryText = (textToSend || input).trim();
    if (!queryText || isLoading) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content: queryText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: queryText,
          chat_history: historyPayload,
        }),
      });

      if (!res.ok) {
        throw new Error("Chat request failed");
      }

      const data = (await res.json()) as ChatResponse;

      const assistantMessage: Message = {
        id: `msg-${Date.now()}-assistant`,
        role: "assistant",
        content: data.answer_markdown,
        folder_cards: data.folder_cards,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      const errorMessage: Message = {
        id: `msg-${Date.now()}-err`,
        role: "assistant",
        content:
          "⚠️ I encountered an error connecting to the search service. Please check server logs or try clicking **Sync OneDrive** in the top right.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const autoResizeTextarea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--color-bg)",
        overflow: "hidden",
      }}
    >
      {/* ─── Top Navbar ────────────────────────────────────────────── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 28px",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-sm)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "var(--radius-sm)",
              background: "linear-gradient(135deg, #4f46e5, #6366f1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(79, 70, 229, 0.25)",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="2" />
            </svg>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                OneDrive Media Locator
              </span>
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "var(--radius-full)",
                  background:
                    syncStatus?.mode === "live"
                      ? "rgba(16, 185, 129, 0.12)"
                      : "rgba(99, 102, 241, 0.12)",
                  color: syncStatus?.mode === "live" ? "#059669" : "#4f46e5",
                  border: `1px solid ${
                    syncStatus?.mode === "live"
                      ? "rgba(16, 185, 129, 0.25)"
                      : "rgba(99, 102, 241, 0.25)"
                  }`,
                }}
              >
                {syncStatus?.mode === "live" ? "● Live Graph API" : "● Demo Mode"}
              </span>
              {syncStatus?.has_delta_link && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    background: "rgba(14, 165, 233, 0.12)",
                    color: "#0369a1",
                    border: "1px solid rgba(14, 165, 233, 0.25)",
                  }}
                >
                  ⚡ Add-on Delta Sync
                </span>
              )}
            </div>
            <span
              style={{
                fontSize: "0.76rem",
                color: "var(--color-text-tertiary)",
              }}
            >
              {(syncStatus?.total_items || 0).toLocaleString()} assets indexed in {(syncStatus?.folders_count || 0).toLocaleString()} folders
            </span>
          </div>
        </div>

        {/* Right actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              borderRadius: "var(--radius-sm)",
              background: isSyncing ? "var(--color-surface-hover)" : "#ffffff",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: isSyncing ? "not-allowed" : "pointer",
              transition: "all var(--transition-fast)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                animation: isSyncing ? "spin 1s linear infinite" : "none",
              }}
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            {isSyncing ? "Syncing..." : "Sync OneDrive"}
          </button>

          {/* User Profile & Sign Out */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingLeft: 12,
              borderLeft: "1px solid var(--color-border)",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-full)",
                background: "linear-gradient(135deg, #e0e7ff, #c7d2fe)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "0.8rem",
                color: "#4338ca",
              }}
            >
              {(user.name || user.email || "U").charAt(0).toUpperCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  lineHeight: 1.2,
                }}
              >
                {user.name || "Employee"}
              </span>
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--color-text-tertiary)",
                }}
              >
                {user.email}
              </span>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              title="Sign Out"
              style={{
                marginLeft: 6,
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                border: "none",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                fontSize: "0.78rem",
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Sync Toast Notification */}
      {syncToast && (
        <div
          style={{
            position: "fixed",
            top: 68,
            right: 28,
            padding: "10px 18px",
            background: "#ffffff",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            fontSize: "0.84rem",
            color: "var(--color-text-primary)",
            fontWeight: 500,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>ℹ️</span> {syncToast}
        </div>
      )}

      {/* ─── Main Chat Scroll Area ─────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 20px 140px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 880 }}>
          {/* Welcome Screen when no messages */}
          {messages.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                marginTop: 40,
                marginBottom: 30,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "var(--radius-md)",
                  background: "linear-gradient(135deg, #eef2ff, #e0e7ff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 18,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </div>

              <h2
                style={{
                  fontSize: "1.6rem",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.03em",
                  marginBottom: 8,
                }}
              >
                Find Company Files & Folders Instantly
              </h2>
              <p
                style={{
                  fontSize: "0.95rem",
                  color: "var(--color-text-secondary)",
                  maxWidth: 540,
                  lineHeight: 1.5,
                  marginBottom: 32,
                }}
              >
                Ask naturally for any video, photoshoot, brand logo, or campaign folder.
                Get verified, clickable OneDrive hyperlinks straight to the source.
              </p>

              {/* Suggestion Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                  width: "100%",
                }}
              >
                {SUGGESTED_QUERIES.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(item.query)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "16px 18px",
                      background: "#ffffff",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                      boxShadow: "var(--shadow-sm)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--color-brand-400)";
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow = "var(--shadow-md)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--color-border)";
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.88rem",
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        marginBottom: 4,
                      }}
                    >
                      {item.title}
                    </span>
                    <span
                      style={{
                        fontSize: "0.78rem",
                        color: "var(--color-text-tertiary)",
                        lineHeight: 1.4,
                      }}
                    >
                      {item.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages Stream */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                marginBottom: 24,
              }}
            >
              {/* Message Header / Timestamp */}
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--color-text-tertiary)",
                  marginBottom: 6,
                  marginLeft: msg.role === "assistant" ? 4 : 0,
                  marginRight: msg.role === "user" ? 4 : 0,
                }}
              >
                {msg.role === "user" ? "You" : "OneDrive Locator"} • {msg.timestamp}
              </span>

              {/* Message Body */}
              <div
                style={{
                  maxWidth: "92%",
                  padding: msg.role === "user" ? "12px 18px" : "18px 22px",
                  borderRadius:
                    msg.role === "user"
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                  background:
                    msg.role === "user"
                      ? "linear-gradient(135deg, #4f46e5, #6366f1)"
                      : "#ffffff",
                  color:
                    msg.role === "user"
                      ? "#ffffff"
                      : "var(--color-text-primary)",
                  border:
                    msg.role === "assistant"
                      ? "1px solid var(--color-border)"
                      : "none",
                  boxShadow:
                    msg.role === "user"
                      ? "0 3px 12px rgba(79, 70, 229, 0.22)"
                      : "var(--shadow-sm)",
                  fontSize: "0.92rem",
                  lineHeight: 1.6,
                }}
              >
                {/* User Message Text */}
                {msg.role === "user" && (
                  <p style={{ margin: 0, fontWeight: 500 }}>{msg.content}</p>
                )}

                {/* Assistant Message Markdown */}
                {msg.role === "assistant" && (
                  <div>
                    <MarkdownRenderer content={msg.content} />

                    {/* Structured Folder Redirect Cards */}
                    {msg.folder_cards && msg.folder_cards.length > 0 && (
                      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                        {msg.folder_cards.map((folder, fIdx) => (
                          <div
                            key={fIdx}
                            style={{
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-md)",
                              padding: "16px 18px",
                              background: "var(--color-surface-hover)",
                              boxShadow: "var(--shadow-sm)",
                            }}
                          >
                            {/* Folder Header */}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                flexWrap: "wrap",
                                gap: 10,
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: "1.25rem" }}>📁</span>
                                <div>
                                  <div
                                    style={{
                                      fontSize: "0.95rem",
                                      fontWeight: 700,
                                      color: "var(--color-text-primary)",
                                    }}
                                  >
                                    {folder.parent_folder_name}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "0.76rem",
                                      color: "var(--color-text-tertiary)",
                                      fontFamily: "monospace",
                                    }}
                                  >
                                    {folder.folder_path}
                                  </div>
                                </div>
                              </div>

                              {/* Primary Folder Link CTA */}
                              <a
                                href={folder.folder_web_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "6px 12px",
                                  background: "#ffffff",
                                  border: "1px solid var(--color-brand-400)",
                                  borderRadius: "var(--radius-sm)",
                                  color: "var(--color-brand-600)",
                                  fontSize: "0.8rem",
                                  fontWeight: 600,
                                  boxShadow: "var(--shadow-sm)",
                                  transition: "all var(--transition-fast)",
                                }}
                              >
                                <span>Open Folder in OneDrive</span>
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                  <polyline points="15 3 21 3 21 9" />
                                  <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                              </a>
                            </div>

                            {/* Child Matching Media Files */}
                            {folder.matched_files.length > 0 && (
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                                  gap: 10,
                                  marginTop: 8,
                                }}
                              >
                                {folder.matched_files.map((file, fileIdx) => (
                                  <div
                                    key={fileIdx}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 12,
                                      padding: "10px 12px",
                                      background: "#ffffff",
                                      border: "1px solid var(--color-border)",
                                      borderRadius: "var(--radius-sm)",
                                    }}
                                  >
                                    {/* Thumbnail Preview */}
                                    {file.thumbnail_url ? (
                                      <img
                                        src={file.thumbnail_url}
                                        alt={file.name}
                                        style={{
                                          width: 44,
                                          height: 44,
                                          objectFit: "cover",
                                          borderRadius: "var(--radius-sm)",
                                          border: "1px solid var(--color-border)",
                                          flexShrink: 0,
                                        }}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: 44,
                                          height: 44,
                                          borderRadius: "var(--radius-sm)",
                                          background: "var(--color-surface-hover)",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: "1.2rem",
                                          flexShrink: 0,
                                        }}
                                      >
                                        {file.record_type === "video" ? "🎬" : "🖼️"}
                                      </div>
                                    )}

                                    {/* File Metadata & Link */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <a
                                        href={file.file_web_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                          fontSize: "0.82rem",
                                          fontWeight: 600,
                                          color: "var(--color-brand-600)",
                                          display: "block",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                        title={file.name}
                                      >
                                        {file.name}
                                      </a>
                                      <span
                                        style={{
                                          fontSize: "0.72rem",
                                          color: "var(--color-text-tertiary)",
                                          display: "block",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {file.visual_summary || file.visual_tags || file.record_type}
                                      </span>
                                    </div>

                                    {/* View Link Arrow */}
                                    <a
                                      href={file.file_web_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Open direct file link"
                                      style={{
                                        color: "var(--color-text-tertiary)",
                                        padding: 4,
                                      }}
                                    >
                                      ↗
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {isLoading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 20px",
                background: "#ffffff",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                width: "fit-content",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "2px solid var(--color-border)",
                  borderTopColor: "var(--color-brand-500)",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "var(--color-text-secondary)",
                }}
              >
                Searching OneDrive metadata and verifying folder links...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ─── Bottom Input Bar ──────────────────────────────────────── */}
      <footer
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "linear-gradient(to top, var(--color-bg) 75%, transparent)",
          padding: "16px 20px 24px 20px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 880,
            background: "#ffffff",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.08)",
            padding: "8px 12px 8px 18px",
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            transition: "border-color var(--transition-fast)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={autoResizeTextarea}
            onKeyDown={handleKeyDown}
            placeholder="Search company media... e.g. 'Find the final Diwali promotional videos and reels'"
            rows={1}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              fontSize: "0.92rem",
              fontFamily: "inherit",
              lineHeight: 1.5,
              padding: "6px 0",
              maxHeight: 140,
              color: "var(--color-text-primary)",
            }}
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={!input.trim() || isLoading}
            style={{
              width: 38,
              height: 38,
              borderRadius: "var(--radius-md)",
              background:
                !input.trim() || isLoading
                  ? "var(--color-surface-hover)"
                  : "linear-gradient(135deg, #4f46e5, #6366f1)",
              border: "none",
              color: !input.trim() || isLoading ? "var(--color-text-tertiary)" : "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: !input.trim() || isLoading ? "not-allowed" : "pointer",
              transition: "all var(--transition-fast)",
              boxShadow:
                !input.trim() || isLoading
                  ? "none"
                  : "0 2px 8px rgba(79, 70, 229, 0.3)",
              flexShrink: 0,
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}

/**
 * Clean Light-Themed Markdown Parser for LLM output
 */
function MarkdownRenderer({ content }: { content: string }) {
  // Simple paragraph & markdown formatter
  const formattedHtml = parseMarkdownToHtml(content);

  return (
    <div
      style={{ lineHeight: 1.7 }}
      dangerouslySetInnerHTML={{ __html: formattedHtml }}
    />
  );
}

function parseMarkdownToHtml(text: string): string {
  let html = text
    // Escape HTML tags to prevent XSS
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic *text*
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Clickable links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; font-weight: 600; text-decoration: underline; text-underline-offset: 3px;">$1 ↗</a>'
  );

  // Bullets
  html = html.replace(/^- (.*)$/gm, '<li style="margin-left: 20px;">$1</li>');

  // Convert newlines to breaks
  html = html.replace(/\n\n/g, '<div style="margin-bottom: 12px;"></div>');
  html = html.replace(/\n/g, "<br />");

  return html;
}
