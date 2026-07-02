/**
 * KOC 种子数据 —— 移植参考实现 _initKocData* 的代表性子集（~20 条），
 * 让 Dashboard 首次加载不空。字段已归一到 canonical Koc 形状（修复 likes/videos →
 * avgViews / engagementRate 推导），并标 source_type: "seed"。
 *
 * 评分在 buildSeed() 里用 scoring.applyScore 统一跑一遍 → 与运行时一致。
 */
import type { Koc } from "./types";
import { applyScore } from "./scoring";

interface RawSeed {
  username: string;
  name: string;
  followers: number;
  likes: number;
  videos: number;
  bio: string;
  region: string;
  city: string;
  category: string;
  language: string;
}

const RAW: RawSeed[] = [
  // —— Nigeria 校园 / 生活 ——
  { username: "panafricanlifestyle", name: "Pan African Lifestyle", followers: 232800, likes: 2800000, videos: 1315, bio: "The Leading Pan-African Multimedia Company & Lifestyle Agency.", region: "NG", city: "Lagos", category: "lifestyle", language: "English" },
  { username: "nigeria.student.am", name: "Nigeria Student Ambassador", followers: 45200, likes: 68400, videos: 148, bio: "I am passionate about empowering your mind.", region: "NG", city: "Lagos", category: "campus", language: "English" },
  { username: "techwhiz.africa", name: "TechWhiz Africa", followers: 34000, likes: 169100, videos: 54, bio: "TikTok tips, Tech tips and tricks.", region: "NG", city: "Lagos", category: "tech", language: "English" },
  { username: "skylineuniversitynigeria", name: "Skyline University Nigeria", followers: 33900, likes: 185300, videos: 255, bio: "The Official Page for Skyline University Nigeria.", region: "NG", city: "Abuja", category: "campus", language: "English" },
  { username: "nile_uni", name: "Nile University of Nigeria", followers: 14800, likes: 240300, videos: 75, bio: "Official TikTok of Nile University of Nigeria.", region: "NG", city: "Abuja", category: "campus", language: "English" },
  { username: "uzaircampuslife", name: "Uzair Campus Life", followers: 11900, likes: 94000, videos: 19, bio: "Living the student life. College Vlogs. Smile Create Repeat.", region: "NG", city: "Lagos", category: "campus", language: "English" },
  { username: "africanstudents.net", name: "African Students Community", followers: 11000, likes: 38000, videos: 125, bio: "Be informed. Be empowered. African student community.", region: "NG", city: "Lagos", category: "campus", language: "English" },
  { username: "lagoslifestyletv", name: "LagoslifestyleTv", followers: 23500, likes: 178100, videos: 120, bio: "Unfiltered Lagos | Real Gist | Lifestyle | Music | Fashion", region: "NG", city: "Lagos", category: "lifestyle", language: "English" },
  { username: "unilagnigeria", name: "University of Lagos", followers: 4247, likes: 49900, videos: 80, bio: "Official TikTok account of the University of Lagos, #UnilagNigeria", region: "NG", city: "Lagos", category: "campus", language: "English" },
  { username: "lagoslifestylee", name: "lagoslifestylee", followers: 1823, likes: 121600, videos: 60, bio: "Lagos through my lens | Paparazzi • Lifestyle • Events | Where vibes meet visuals", region: "NG", city: "Lagos", category: "lifestyle", language: "English" },
  { username: "naija_fashion_styles", name: "Naija Fashion Styles", followers: 131400, likes: 2500000, videos: 400, bio: "Nigerian fashion & lifestyle content | Style inspiration", region: "NG", city: "Lagos", category: "fashion", language: "English" },
  { username: "abuja_lifestyle1", name: "Abuja Lifestyle", followers: 18300, likes: 778000, videos: 200, bio: "Abuja lifestyle vlog | Street gist | Food | Entertainment", region: "NG", city: "Abuja", category: "lifestyle", language: "English" },
  { username: "oceeythecreator", name: "Abuja Lifestyle Photographer", followers: 5758, likes: 245800, videos: 90, bio: "Abuja lifestyle photographer & content creator | Capturing real moments", region: "NG", city: "Abuja", category: "lifestyle", language: "English" },
  { username: "bookishigboqueen", name: "Books Cocktails Lagos Life", followers: 11100, likes: 101300, videos: 110, bio: "Lagos lifestyle | Books | Cocktails | City life content", region: "NG", city: "Lagos", category: "lifestyle", language: "English" },
  { username: "alphacruisetravels", name: "Alpha Cruise Travels", followers: 19200, likes: 289700, videos: 150, bio: "Travel vlog Nigeria | Lagos travel content | Adventure & lifestyle", region: "NG", city: "Lagos", category: "lifestyle", language: "English" },
  // —— 低质 / 风险样本（让筛选表有 risk / fail 行）——
  { username: "campus_vibes_ng", name: "Campus Vibes NG", followers: 62000, likes: 12000, videos: 300, bio: "Campus entertainment page.", region: "NG", city: "Lagos", category: "entertainment", language: "English" },
  { username: "elite_tech_africa", name: "ELITE TECH AFRICA", followers: 5001, likes: 8839, videos: 100, bio: "Installation and Tech Security. Cotonou, Benin.", region: "BJ", city: "Other", category: "tech", language: "Multi" },
  // —— Pakistan 美食（跨市场样本）——
  { username: "fahad.chaudhary569", name: "Fahad Chaudhary", followers: 36200, likes: 1600000, videos: 220, bio: "The Helal Vlogger. Food, Fashion, Travel. Clinical Dietitian.", region: "PK", city: "Lahore", category: "food", language: "Urdu/English" },
  { username: "mahinmade_", name: "Mahin", followers: 25500, likes: 509100, videos: 150, bio: "food, travel, and some bakwas. third culture gal.", region: "PK", city: "Lahore", category: "food", language: "Urdu/English" },
  { username: "triptuck", name: "Trip Tuck", followers: 73100, likes: 1800000, videos: 180, bio: "Jithay Roti Othay Esi.", region: "PK", city: "Lahore", category: "food", language: "Urdu/English" },
];

function tierOf(f: number): string {
  if (f >= 300000) return "300k+";
  if (f >= 100000) return "100k-300k";
  if (f >= 50000) return "50k-100k";
  if (f >= 30000) return "30k-100k";
  if (f >= 10000) return "10k-30k";
  if (f >= 5000) return "5k-10k";
  return "1k-5k";
}

export function buildSeed(): Koc[] {
  const now = new Date().toISOString();
  return RAW.map((a, i) => {
    const avgViews = Math.round(a.likes / (a.videos || 1));
    // 单条平均互动 / 粉丝；对小号病毒视频（互动 > 粉丝）钳制到合理上限，避免算出 >100% 的失真互动率。
    const rawEng = a.followers > 0 ? (avgViews / a.followers) * 100 : 0;
    const engagementRate = parseFloat(Math.min(rawEng, 30).toFixed(2));
    const base: Koc = {
      id: `seed_${a.username}`,
      platform: "tiktok",
      name: a.name,
      username: a.username,
      url: "https://www.tiktok.com/@" + a.username,
      city: a.city,
      tier: tierOf(a.followers),
      category: a.category,
      followers: a.followers,
      avgViews,
      engagementRate,
      bio: a.bio,
      region: a.region,
      geoLabel: a.region,
      language: a.language,
      nigeriaLocalAudience: a.region === "NG" ? 55 : 0,
      hasTechContent: /tech/i.test(a.bio) ? "yes" : "no",
      tags: [],
      manualRisks: [],
      source_type: "seed",
      addedAt: now,
      events: [
        {
          id: `ev_seed_${i}`,
          kind: "created",
          title: "种子数据导入",
          input: `${a.name} · ${a.followers} followers`,
          at: Date.now(),
        },
      ],
    };
    return applyScore(base);
  });
}
