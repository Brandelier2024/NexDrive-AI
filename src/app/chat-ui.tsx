"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { FolderCard, ChatResponse } from "@/lib/types";

let globalIdCounter = 0;
function generateUniqueId(prefix: string): string {
  globalIdCounter++;
  return `${prefix}-${globalIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

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

  // Chat History & Sessions State
  const [sessions, setSessions] = useState<{
    id: string;
    title: string;
    lastMessage: string;
    lastTimestamp: string;
    messageCount: number;
  }[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("default");
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Profile & Account Management State
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState<{
    id?: string;
    name?: string;
    email?: string;
    auth_provider?: string;
    created_at?: string;
  } | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Drive Search Scope (Company Shared vs Personal OneDrive)
  const [searchScope, setSearchScope] = useState<"all" | "company" | "personal">("all");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userNavigatedRef = useRef(false);

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

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


  // Load sync status and chat history on mount
  useEffect(() => {
    let active = true;

    fetch("/api/onedrive/sync")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setSyncStatus(data);
      })
      .catch(() => {});

    fetch("/api/chat/history")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data || userNavigatedRef.current) return;
        if (data.sessions) setSessions(data.sessions);
        if (data.activeSessionId) setActiveSessionId(data.activeSessionId);
        if (data.messages && data.messages.length > 0) {
          const mapped: Message[] = data.messages.map((m: { id?: string; role: "user" | "assistant"; content: string; folder_cards?: FolderCard[]; created_at?: string }) => ({
            id: m.id || generateUniqueId(`msg-${m.role}`),
            role: m.role,
            content: m.content,
            folder_cards: m.folder_cards,
            timestamp: m.created_at
              ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }));
          setMessages(mapped);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSelectSession = async (sessionId: string) => {
    userNavigatedRef.current = true;
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          const mapped: Message[] = data.messages.map((m: { id?: string; role: "user" | "assistant"; content: string; folder_cards?: FolderCard[]; created_at?: string }) => ({
            id: m.id || generateUniqueId(`msg-${m.role}`),
            role: m.role,
            content: m.content,
            folder_cards: m.folder_cards,
            timestamp: m.created_at
              ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }));
          setMessages(mapped);
        }
      }
    } catch (err) {
      console.error("[Chat History] Select session error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    userNavigatedRef.current = true;
    const newSessionId = generateUniqueId("session");
    setActiveSessionId(newSessionId);
    setMessages([]);
    setInput("");
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeletingSessionId(sessionId);
    try {
      const res = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("[Chat History] Delete session error:", err);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleClearAllHistory = async () => {
    if (!confirm("Are you sure you want to clear your entire search history?")) return;
    try {
      const res = await fetch("/api/chat/history?sessionId=all", { method: "DELETE" });
      if (res.ok) {
        setSessions([]);
        handleNewChat();
      }
    } catch (err) {
      console.error("[Chat History] Clear all error:", err);
    }
  };

  const handleOpenProfile = async () => {
    setIsProfileOpen(true);
    setShowDeleteConfirm(false);
    setDeleteError("");
    try {
      const res = await fetch("/api/user/profile");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setProfileData(data.user);
        }
      }
    } catch {
      // fallback to user prop
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/user/delete-account", {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDeleteError(data.error || "Failed to delete account. Please try again.");
        setIsDeletingAccount(false);
        return;
      }
      // Successfully deleted in Supabase -> terminate NextAuth session and redirect
      await signOut({ callbackUrl: "/auth/signin?deleted=true" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred while deleting your account.";
      setDeleteError(message);
      setIsDeletingAccount(false);
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
    userNavigatedRef.current = true;
    const queryText = (textToSend || input).trim();
    if (!queryText || isLoading) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMessage: Message = {
      id: generateUniqueId("msg-user"),
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
          session_id: activeSessionId,
          scope: searchScope,
        }),
      });

      if (!res.ok) {
        throw new Error("Chat request failed");
      }

      const data = (await res.json()) as ChatResponse;

      const assistantMessage: Message = {
        id: generateUniqueId("msg-assistant"),
        role: "assistant",
        content: data.answer_markdown,
        folder_cards: data.folder_cards,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Update session title & timestamp in history sidebar
      setSessions((prev) => {
        const existing = prev.find((s) => s.id === activeSessionId);
        if (existing) {
          return [
            {
              ...existing,
              lastMessage: data.answer_markdown.slice(0, 80),
              lastTimestamp: new Date().toISOString(),
              messageCount: existing.messageCount + 2,
            },
            ...prev.filter((s) => s.id !== activeSessionId),
          ];
        } else {
          return [
            {
              id: activeSessionId,
              title: queryText,
              lastMessage: data.answer_markdown.slice(0, 80),
              lastTimestamp: new Date().toISOString(),
              messageCount: 2,
            },
            ...prev,
          ];
        }
      });
    } catch {
      const errorMessage: Message = {
        id: generateUniqueId("msg-err"),
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Sidebar Toggle Button */}
          <button
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            id="toggle-history-sidebar-btn"
            title={isSidebarOpen ? "Collapse search history sidebar" : "Show search history sidebar"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              background: isSidebarOpen ? "#eef2ff" : "#f8fafc",
              border: "1px solid",
              borderColor: isSidebarOpen ? "#c7d2fe" : "var(--color-border)",
              color: isSidebarOpen ? "#4f46e5" : "var(--color-text-secondary)",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            <span style={{ fontSize: "0.8rem" }}>History</span>
            {sessions.length > 0 && (
              <span
                style={{
                  fontSize: "0.68rem",
                  background: isSidebarOpen ? "#4f46e5" : "#e2e8f0",
                  color: isSidebarOpen ? "#ffffff" : "#475569",
                  padding: "1px 6px",
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                {sessions.length}
              </span>
            )}
          </button>

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
              <Link
                href="/"
                style={{
                  textDecoration: "none",
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                DriveFinder AI
              </Link>
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

          {/* User Profile Trigger & Sign Out */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingLeft: 12,
              borderLeft: "1px solid var(--color-border)",
            }}
          >
            <button
              onClick={handleOpenProfile}
              id="profile-trigger-btn"
              title="Click to view profile & account settings"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "4px 8px",
                borderRadius: "var(--radius-md)",
                background: "transparent",
                border: "1px solid transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f1f5f9";
                e.currentTarget.style.borderColor = "var(--color-border)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-full)",
                  background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  color: "#ffffff",
                  boxShadow: "0 2px 4px rgba(79, 70, 229, 0.25)",
                  flexShrink: 0,
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
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "#4f46e5",
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "#eef2ff",
                  border: "1px solid #c7d2fe",
                  marginLeft: 4,
                }}
              >
                Profile
              </span>
            </button>

            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              title="Sign Out"
              style={{
                marginLeft: 2,
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                border: "none",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                fontSize: "0.78rem",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#dc2626";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--color-text-tertiary)";
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

      {/* ─── Body Layout: Sidebar + Main Chat Area ─────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        {/* ─── Left Sidebar: Chat History ─── */}
        <aside
          id="chat-history-sidebar"
          style={{
            width: isSidebarOpen ? 290 : 0,
            minWidth: isSidebarOpen ? 290 : 0,
            borderRight: isSidebarOpen ? "1px solid var(--color-border)" : "none",
            background: "var(--color-surface)",
            display: "flex",
            flexDirection: "column",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            overflow: "hidden",
            zIndex: 15,
            boxShadow: isSidebarOpen ? "2px 0 8px rgba(0,0,0,0.03)" : "none",
          }}
        >
          {/* Sidebar Top: New Search Button */}
          <div style={{ padding: "16px 14px 12px 14px", borderBottom: "1px solid var(--color-border)" }}>
            <button
              onClick={handleNewChat}
              id="new-chat-btn"
              title="Start a new search conversation"
              style={{
                width: "100%",
                padding: "9px 14px",
                background: "linear-gradient(135deg, #4f46e5, #6366f1)",
                color: "#ffffff",
                border: "none",
                borderRadius: "var(--radius-md)",
                fontSize: "0.84rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(79, 70, 229, 0.22)",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.95";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "none";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Search</span>
            </button>
          </div>

          {/* Sidebar Section Title */}
          <div
            style={{
              padding: "12px 16px 6px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Recent Searches
            </span>
            {sessions.length > 0 && (
              <span style={{ fontSize: "0.7rem", color: "#64748b" }}>
                {sessions.length} saved
              </span>
            )}
          </div>

          {/* Sessions List */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "4px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {isHistoryLoading ? (
              <div style={{ padding: "30px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "0.82rem" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    border: "2px solid #c7d2fe",
                    borderTopColor: "#4f46e5",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                    marginBottom: 8,
                  }}
                />
                <div>Loading history...</div>
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: "32px 14px", textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem", marginBottom: 8, opacity: 0.6 }}>🔍</div>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                  No past searches yet
                </div>
                <div style={{ fontSize: "0.74rem", color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
                  Your search queries and retrieved files will appear here.
                </div>
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                const isDeleting = deletingSessionId === sess.id;
                return (
                  <div
                    key={sess.id}
                    onClick={() => handleSelectSession(sess.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      background: isActive ? "#eef2ff" : "transparent",
                      border: `1px solid ${isActive ? "#c7d2fe" : "transparent"}`,
                      transition: "all 0.12s ease",
                      position: "relative",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          color: isActive ? "#4f46e5" : "#94a3b8",
                          marginTop: 2,
                          flexShrink: 0,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "0.82rem",
                            fontWeight: isActive ? 700 : 500,
                            color: isActive ? "#312e81" : "var(--color-text-primary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            lineHeight: 1.3,
                          }}
                        >
                          {sess.title || "Search query"}
                        </div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: isActive ? "#6366f1" : "var(--color-text-tertiary)",
                            marginTop: 2,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span>{formatSessionDate(sess.lastTimestamp)}</span>
                          {sess.messageCount > 0 && (
                            <>
                              <span>&bull;</span>
                              <span>{Math.ceil(sess.messageCount / 2)} query</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleDeleteSession(e, sess.id)}
                      disabled={isDeleting}
                      title="Delete this search"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#94a3b8",
                        padding: 4,
                        borderRadius: 4,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: 0.6,
                        transition: "opacity 0.15s ease, color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = "1";
                        e.currentTarget.style.color = "#dc2626";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = "0.6";
                        e.currentTarget.style.color = "#94a3b8";
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Sidebar Footer: Clear All History */}
          {sessions.length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <button
                onClick={handleClearAllHistory}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#dc2626";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#94a3b8";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Clear search history
              </button>
            </div>
          )}
        </aside>

        {/* ─── Chat Area (Scroll area + Footer input) ─── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          {/* Main Chat Scroll Area */}
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
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                    <span>{folder.parent_folder_name}</span>
                                    {folder.is_personal ? (
                                      <span
                                        style={{
                                          fontSize: "0.68rem",
                                          fontWeight: 600,
                                          color: "#7c3aed",
                                          background: "#f5f3ff",
                                          border: "1px solid #ddd6fe",
                                          padding: "1px 7px",
                                          borderRadius: 9999,
                                        }}
                                      >
                                        Personal OneDrive
                                      </span>
                                    ) : (
                                      <span
                                        style={{
                                          fontSize: "0.68rem",
                                          fontWeight: 600,
                                          color: "#475569",
                                          background: "#f1f5f9",
                                          border: "1px solid #e2e8f0",
                                          padding: "1px 7px",
                                          borderRadius: 9999,
                                        }}
                                      >
                                        Company Shared
                                      </span>
                                    )}
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

                            {/* Folder Directory Notice if no separate media thumbnails */}
                            {folder.matched_files.length === 0 && (
                              <div
                                style={{
                                  fontSize: "0.78rem",
                                  color: "var(--color-text-tertiary)",
                                  fontStyle: "italic",
                                  padding: "4px 2px",
                                }}
                              >
                                📁 Company folder directory in OneDrive — Click &quot;Open Folder in OneDrive&quot; above to view all files.
                              </div>
                            )}

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
          left: isSidebarOpen ? 290 : 0,
          right: 0,
          background: "linear-gradient(to top, var(--color-bg) 75%, transparent)",
          padding: "16px 20px 24px 20px",
          display: "flex",
          justifyContent: "center",
          transition: "left 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 880,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Drive Search Scope Toggle */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setSearchScope("all")}
              style={{
                fontSize: "0.78rem",
                padding: "3px 10px",
                borderRadius: "9999px",
                border: "1px solid",
                borderColor: searchScope === "all" ? "#4f46e5" : "var(--color-border)",
                background: searchScope === "all" ? "#eef2ff" : "rgba(255, 255, 255, 0.8)",
                color: searchScope === "all" ? "#4f46e5" : "var(--color-text-secondary)",
                fontWeight: searchScope === "all" ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              All Drives
            </button>
            <button
              type="button"
              onClick={() => setSearchScope("company")}
              style={{
                fontSize: "0.78rem",
                padding: "3px 10px",
                borderRadius: "9999px",
                border: "1px solid",
                borderColor: searchScope === "company" ? "#4f46e5" : "var(--color-border)",
                background: searchScope === "company" ? "#eef2ff" : "rgba(255, 255, 255, 0.8)",
                color: searchScope === "company" ? "#4f46e5" : "var(--color-text-secondary)",
                fontWeight: searchScope === "company" ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              Company Shared
            </button>
            <button
              type="button"
              onClick={() => setSearchScope("personal")}
              style={{
                fontSize: "0.78rem",
                padding: "3px 10px",
                borderRadius: "9999px",
                border: "1px solid",
                borderColor: searchScope === "personal" ? "#7c3aed" : "var(--color-border)",
                background: searchScope === "personal" ? "#f5f3ff" : "rgba(255, 255, 255, 0.8)",
                color: searchScope === "personal" ? "#7c3aed" : "var(--color-text-secondary)",
                fontWeight: searchScope === "personal" ? 600 : 500,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                transition: "all 0.15s ease",
              }}
            >
              <span>My Personal OneDrive</span>
              <span style={{ fontSize: "0.68rem", opacity: 0.8, background: "#ede9fe", padding: "1px 5px", borderRadius: 4 }}>
                {user?.email ? user.email.split("@")[0] : "Personal"}
              </span>
            </button>
          </div>

          <div
            style={{
              width: "100%",
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
              placeholder={
                searchScope === "personal"
                  ? `Search your personal OneDrive files (${user?.email || "My Files"})...`
                  : searchScope === "company"
                  ? "Search company media library... e.g. 'Diwali campaign videos'"
                  : "Search company & personal files... e.g. 'Diwali videos' or 'my documents'"
              }
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
      </div>
    </footer>
        </div>
      </div>

      {/* Account Profile Modal */}
      {isProfileOpen && (
        <div
          id="profile-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeletingAccount) {
              setIsProfileOpen(false);
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <div
            id="profile-modal-card"
            style={{
              background: "#ffffff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 500,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0,0,0,0.06)",
              overflow: "hidden",
              border: "1px solid #e2e8f0",
              animation: "scaleIn 0.2s ease-out",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #f1f5f9",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#f8fafc",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "#eef2ff",
                    color: "#4f46e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                    Employee Profile
                  </h2>
                  <p style={{ fontSize: "0.78rem", color: "#64748b", margin: 0 }}>
                    Brandelier Corporate Account &amp; Access Details
                  </p>
                </div>
              </div>

              <button
                onClick={() => !isDeletingAccount && setIsProfileOpen(false)}
                title="Close"
                id="close-profile-btn"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 6,
                  borderRadius: 6,
                  cursor: isDeletingAccount ? "not-allowed" : "pointer",
                  color: "#94a3b8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#e2e8f0";
                  e.currentTarget.style.color = "#334155";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#94a3b8";
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: "24px" }}>
              {/* User Identity Card */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: 16,
                  background: "#f8fafc",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontSize: "1.4rem",
                    fontWeight: 700,
                    boxShadow: "0 4px 10px rgba(79, 70, 229, 0.3)",
                    flexShrink: 0,
                  }}
                >
                  {(profileData?.name || user.name || user.email || "U").charAt(0).toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <h3
                      id="profile-user-name"
                      style={{
                        margin: 0,
                        fontSize: "1.05rem",
                        fontWeight: 700,
                        color: "#0f172a",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {profileData?.name || user.name || "Employee"}
                    </h3>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 600,
                        color: "#059669",
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        padding: "2px 6px",
                        borderRadius: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Verified
                    </span>
                  </div>

                  <p
                    id="profile-user-email"
                    style={{
                      margin: 0,
                      fontSize: "0.82rem",
                      color: "#64748b",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {profileData?.email || user.email}
                  </p>
                </div>
              </div>

              {/* Corporate Details Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: "0.72rem", color: "#64748b", display: "block", marginBottom: 2 }}>
                    Organization
                  </span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1e293b" }}>
                    Brandelier India
                  </span>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: "0.72rem", color: "#64748b", display: "block", marginBottom: 2 }}>
                    Corporate Domain
                  </span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#4f46e5" }}>
                    @brandelier.in
                  </span>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: "0.72rem", color: "#64748b", display: "block", marginBottom: 2 }}>
                    Authentication
                  </span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1e293b" }}>
                    {profileData?.auth_provider === "azure-ad" ? "Microsoft SSO" : "Email OTP Verified"}
                  </span>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: "0.72rem", color: "#64748b", display: "block", marginBottom: 2 }}>
                    Media Index Access
                  </span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#059669" }}>
                    19,200+ Assets (Full)
                  </span>
                </div>
              </div>

              {/* Danger Zone: Account Deletion */}
              <div
                style={{
                  border: "1px solid #fee2e2",
                  borderRadius: 12,
                  background: "#fffafb",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700, color: "#991b1b" }}>
                    Danger Zone
                  </h4>
                </div>

                <p style={{ margin: "0 0 14px 0", fontSize: "0.78rem", color: "#7f1d1d", lineHeight: 1.5 }}>
                  Deleting your account will permanently wipe your profile, personal chat query history, and system access from Brandelier. This action is irreversible.
                </p>

                {deleteError && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "#fef2f2",
                      border: "1px solid #f87171",
                      borderRadius: 6,
                      color: "#b91c1c",
                      fontSize: "0.76rem",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>⚠️</span>
                    <span>{deleteError}</span>
                  </div>
                )}

                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    id="initiate-delete-account-btn"
                    style={{
                      background: "#ffffff",
                      border: "1px solid #fca5a5",
                      color: "#dc2626",
                      borderRadius: 8,
                      padding: "8px 14px",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#fef2f2";
                      e.currentTarget.style.borderColor = "#f87171";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#fca5a5";
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Delete Account
                  </button>
                ) : (
                  <div
                    id="delete-confirmation-box"
                    style={{
                      background: "#fef2f2",
                      border: "1px solid #f87171",
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <p
                      style={{
                        margin: "0 0 12px 0",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "#991b1b",
                      }}
                    >
                      Are you absolutely sure you want to delete your account?
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={handleDeleteAccount}
                        disabled={isDeletingAccount}
                        id="confirm-delete-account-btn"
                        style={{
                          background: "#dc2626",
                          border: "none",
                          color: "#ffffff",
                          borderRadius: 6,
                          padding: "8px 14px",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          cursor: isDeletingAccount ? "wait" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          boxShadow: "0 2px 4px rgba(220, 38, 38, 0.25)",
                          opacity: isDeletingAccount ? 0.7 : 1,
                        }}
                      >
                        {isDeletingAccount ? (
                          <>
                            <span
                              style={{
                                display: "inline-block",
                                width: 12,
                                height: 12,
                                border: "2px solid rgba(255,255,255,0.4)",
                                borderTopColor: "#fff",
                                borderRadius: "50%",
                                animation: "spin 0.8s linear infinite",
                              }}
                            />
                            Deleting Account...
                          </>
                        ) : (
                          <>
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
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Yes, Permanently Delete
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteError("");
                        }}
                        disabled={isDeletingAccount}
                        id="cancel-delete-account-btn"
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          color: "#475569",
                          borderRadius: 6,
                          padding: "8px 14px",
                          fontSize: "0.82rem",
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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

function formatSessionDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (isNaN(date.getTime())) return "";
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

