import { OneDriveRecord } from "@/lib/types";

/**
 * Realistic company OneDrive media items used for testing
 * and demo mode when live Azure AD credentials are not yet configured.
 */
export const MOCK_ONEDRIVE_ITEMS: OneDriveRecord[] = [
  // ─── Folders ──────────────────────────────────────────────────
  {
    item_id: "folder-diwali-exports",
    record_type: "folder",
    name: "03_Final_Exports",
    file_web_url: null,
    parent_folder_id: "folder-diwali-campaign",
    parent_folder_name: "Diwali",
    folder_path: "Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    thumbnail_url: null,
    media_type: null,
    visual_summary:
      "Folder containing final promotional videos, reels, and high-res campaign assets for Diwali 2026.",
    visual_tags: "diwali, campaign, 2026, marketing, final exports, festival, promo",
    last_modified: "2026-10-15T09:00:00Z",
  },
  {
    item_id: "folder-logos",
    record_type: "folder",
    name: "Master_Files",
    file_web_url: null,
    parent_folder_id: "folder-brand-assets",
    parent_folder_name: "Logos_and_Typography",
    folder_path: "Brand_Assets/Logos_and_Typography/Master_Files",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/Logos_and_Typography/Master_Files",
    thumbnail_url: null,
    media_type: null,
    visual_summary:
      "Brand identity folder with official company logo vectors, typography kits, color palettes, and icons.",
    visual_tags: "brand, logos, vectors, typography, brandelier, master files, graphics",
    last_modified: "2026-09-01T12:00:00Z",
  },
  {
    item_id: "folder-reels",
    record_type: "folder",
    name: "Vertical_Videos",
    file_web_url: null,
    parent_folder_id: "folder-product-launch",
    parent_folder_name: "2026_Q1_Reels",
    folder_path: "Product_Launches/2026_Q1_Reels/Vertical_Videos",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Product_Launches/2026_Q1_Reels/Vertical_Videos",
    thumbnail_url: null,
    media_type: null,
    visual_summary:
      "Social media short-form video content folder containing 9:16 vertical reels and TikTok exports.",
    visual_tags: "social media, reels, vertical video, 9:16, product launch, tiktok, instagram",
    last_modified: "2026-10-10T14:30:00Z",
  },
  {
    item_id: "folder-events",
    record_type: "folder",
    name: "Photos",
    file_web_url: null,
    parent_folder_id: "folder-gala-2025",
    parent_folder_name: "Annual_Gala_2025",
    folder_path: "Corporate_Events/Annual_Gala_2025/Photos",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/events/Documents/Corporate_Events/Annual_Gala_2025/Photos",
    thumbnail_url: null,
    media_type: null,
    visual_summary:
      "Event photography folder from company Annual Gala celebration with team and award ceremony photos.",
    visual_tags: "corporate event, annual gala, photos, team celebration, award night, party",
    last_modified: "2025-12-20T18:00:00Z",
  },

  // ─── Diwali Media Files ───────────────────────────────────────
  {
    item_id: "file-diwali-v2",
    record_type: "video",
    name: "Diwali_Promo_Final_v2.mp4",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:v:/g/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports/Diwali_Promo_Final_v2.mp4",
    parent_folder_id: "folder-diwali-exports",
    parent_folder_name: "03_Final_Exports",
    folder_path: "Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    thumbnail_url:
      "https://images.unsplash.com/photo-1605371924599-2d0365da1ae0?auto=format&fit=crop&w=800&q=80",
    media_type: "video/mp4",
    visual_summary:
      "A cinematic promotional video showcasing illuminated earthen lamps (diyas), glowing golden lanterns, and festive gift packaging with animated text overlays.",
    visual_tags: "diwali, promo, lanterns, diyas, gold theme, festive, commercial, holiday campaign, 4k",
    last_modified: "2026-10-15T09:15:00Z",
  },
  {
    item_id: "file-diwali-teaser",
    record_type: "video",
    name: "Diwali_Teaser_Story_15s.mp4",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:v:/g/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports/Diwali_Teaser_Story_15s.mp4",
    parent_folder_id: "folder-diwali-exports",
    parent_folder_name: "03_Final_Exports",
    folder_path: "Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    thumbnail_url:
      "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=800&q=80",
    media_type: "video/mp4",
    visual_summary:
      "15-second fast-paced Instagram story teaser featuring sparkles, fireworks, and discount announcement countdown.",
    visual_tags: "diwali, teaser, instagram story, vertical, 15 seconds, sparkles, fireworks, discount",
    last_modified: "2026-10-14T16:00:00Z",
  },
  {
    item_id: "file-diwali-banner",
    record_type: "image",
    name: "Diwali_Hero_Banner_Desktop.png",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:i:/g/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports/Diwali_Hero_Banner_Desktop.png",
    parent_folder_id: "folder-diwali-exports",
    parent_folder_name: "03_Final_Exports",
    folder_path: "Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/2026_Campaigns/Diwali/03_Final_Exports",
    thumbnail_url:
      "https://images.unsplash.com/photo-1543807535-eceef0bc6599?auto=format&fit=crop&w=800&q=80",
    media_type: "image/png",
    visual_summary:
      "High resolution wide header graphic for website home page with warm festive lighting and gold typography.",
    visual_tags: "diwali, banner, hero image, website header, desktop graphic, warm lights, gold",
    last_modified: "2026-10-13T11:20:00Z",
  },

  // ─── Brand Logos ──────────────────────────────────────────────
  {
    item_id: "file-logo-primary",
    record_type: "image",
    name: "Brand_Logo_Primary_Color.png",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:i:/g/personal/marketing/Documents/Brand_Assets/Logos_and_Typography/Master_Files/Brand_Logo_Primary_Color.png",
    parent_folder_id: "folder-logos",
    parent_folder_name: "Master_Files",
    folder_path: "Brand_Assets/Logos_and_Typography/Master_Files",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/Logos_and_Typography/Master_Files",
    thumbnail_url:
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
    media_type: "image/png",
    visual_summary:
      "Official company logo on transparent background featuring clean blue and purple gradient emblem and modern wordmark.",
    visual_tags: "brand, logo, primary color, brandelier, emblem, gradient, transparent png, official",
    last_modified: "2026-09-01T12:10:00Z",
  },
  {
    item_id: "file-icon-monochrome",
    record_type: "image",
    name: "Brand_Icon_Monochrome_Dark.svg",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:i:/g/personal/marketing/Documents/Brand_Assets/Logos_and_Typography/Master_Files/Brand_Icon_Monochrome_Dark.svg",
    parent_folder_id: "folder-logos",
    parent_folder_name: "Master_Files",
    folder_path: "Brand_Assets/Logos_and_Typography/Master_Files",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Brand_Assets/Logos_and_Typography/Master_Files",
    thumbnail_url:
      "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=800&q=80",
    media_type: "image/svg+xml",
    visual_summary:
      "Monochrome single-color vector glyph designed for dark theme application navigation and favicons.",
    visual_tags: "icon, monochrome, dark mode, svg, vector, favicon, symbol, app icon",
    last_modified: "2026-09-02T10:00:00Z",
  },

  // ─── Reels & Social Media ─────────────────────────────────────
  {
    item_id: "file-reel-unboxing",
    record_type: "video",
    name: "Product_Unboxing_Reel_01.mp4",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:v:/g/personal/marketing/Documents/Product_Launches/2026_Q1_Reels/Vertical_Videos/Product_Unboxing_Reel_01.mp4",
    parent_folder_id: "folder-reels",
    parent_folder_name: "Vertical_Videos",
    folder_path: "Product_Launches/2026_Q1_Reels/Vertical_Videos",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Product_Launches/2026_Q1_Reels/Vertical_Videos",
    thumbnail_url:
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80",
    media_type: "video/mp4",
    visual_summary:
      "Close-up unboxing reel revealing new product hardware from premium matte packaging with sound effects.",
    visual_tags: "product launch, unboxing, vertical reel, hardware, packaging, modern tech, 9:16",
    last_modified: "2026-10-08T11:45:00Z",
  },
  {
    item_id: "file-reel-drone",
    record_type: "video",
    name: "Summer_Launch_Drone_Footage_4K.mov",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:v:/g/personal/marketing/Documents/Product_Launches/2026_Q1_Reels/Vertical_Videos/Summer_Launch_Drone_Footage_4K.mov",
    parent_folder_id: "folder-reels",
    parent_folder_name: "Vertical_Videos",
    folder_path: "Product_Launches/2026_Q1_Reels/Vertical_Videos",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/marketing/Documents/Product_Launches/2026_Q1_Reels/Vertical_Videos",
    thumbnail_url:
      "https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=800&q=80",
    media_type: "video/quicktime",
    visual_summary:
      "Scenic 4K drone sweep across sunlit outdoor venue with cinematic color grading for summer marketing.",
    visual_tags: "drone footage, 4k, aerial, summer launch, cinematic, outdoor, landscape, mov",
    last_modified: "2026-10-09T15:20:00Z",
  },

  // ─── Corporate Photos ─────────────────────────────────────────
  {
    item_id: "file-team-photoshoot",
    record_type: "image",
    name: "Office_Team_Photoshoot_Wide.jpg",
    file_web_url:
      "https://brandelier-my.sharepoint.com/:i:/g/personal/events/Documents/Corporate_Events/Annual_Gala_2025/Photos/Office_Team_Photoshoot_Wide.jpg",
    parent_folder_id: "folder-events",
    parent_folder_name: "Photos",
    folder_path: "Corporate_Events/Annual_Gala_2025/Photos",
    folder_web_url:
      "https://brandelier-my.sharepoint.com/personal/events/Documents/Corporate_Events/Annual_Gala_2025/Photos",
    thumbnail_url:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80",
    media_type: "image/jpeg",
    visual_summary:
      "Group portrait of the engineering and design team gathered in a modern sunlit open office space.",
    visual_tags: "team, photoshoot, office, employees, group photo, company culture, staff",
    last_modified: "2025-12-21T09:30:00Z",
  },
];
