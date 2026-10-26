/**
 * TypeScript Data Models for OneDrive Media Locator
 */

export type RecordType = "folder" | "image" | "video";

/** Raw Microsoft Graph item returned from /delta or drive items API */
export interface OneDriveGraphItem {
  id: string;
  name: string;
  webUrl: string;
  folder?: {
    childCount?: number;
  };
  file?: {
    mimeType?: string;
  };
  image?: {
    width?: number;
    height?: number;
  };
  video?: {
    duration?: number;
    width?: number;
    height?: number;
  };
  parentReference?: {
    id?: string;
    path?: string;
    driveId?: string;
  };
  lastModifiedDateTime?: string;
  deleted?: {
    state?: string;
  };
  "@odata.type"?: string;
}

/** Vector Database record stored in Supabase onedrive_items */
export interface OneDriveRecord {
  id?: string;
  item_id: string;
  record_type: RecordType;
  name: string;
  file_web_url: string | null;
  parent_folder_id: string | null;
  parent_folder_name: string | null;
  folder_path: string;
  folder_web_url: string;
  thumbnail_url: string | null;
  media_type: string | null;
  visual_summary: string | null;
  visual_tags: string | null;
  last_modified: string | null;
  embedding?: number[] | null;
  similarity?: number;
  is_personal?: boolean;
  drive_scope?: "company" | "personal" | "shared_storage";
  storage_account?: string;
}

/** Structured file match inside a folder */
export interface MatchedFile {
  item_id: string;
  name: string;
  file_web_url: string;
  record_type: "image" | "video";
  media_type?: string;
  thumbnail_url?: string;
  visual_summary?: string;
  visual_tags?: string;
  similarity?: number;
  is_personal?: boolean;
  drive_scope?: "company" | "personal" | "shared_storage";
  storage_account?: string;
}

/** Parent-first Folder Card presentation model */
export interface FolderCard {
  parent_folder_id?: string;
  parent_folder_name: string;
  folder_path: string;
  folder_web_url: string;
  thumbnail_url?: string;
  highest_similarity?: number;
  matched_files: MatchedFile[];
  is_personal?: boolean;
  drive_scope?: "company" | "personal" | "shared_storage";
  storage_account?: string;
}

/** Chat API Request payload */
export interface ChatRequest {
  message: string;
  chat_history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  session_id?: string;
  scope?: "all" | "company" | "personal";
}

/** Chat API Response payload */
export interface ChatResponse {
  answer_markdown: string;
  folder_cards: FolderCard[];
  query: string;
  rewritten_query?: string;
  timestamp: string;
  duration_ms?: number;
}

/** Sync API Response */
export interface SyncResult {
  success: boolean;
  mode: "live" | "demo_mock";
  items_processed: number;
  folders_indexed: number;
  media_indexed: number;
  deleted_count: number;
  duration_ms: number;
  error?: string;
}
