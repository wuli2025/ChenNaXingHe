import { defineStore } from "pinia";
import { ref } from "vue";

const STORAGE_KEY = "polaris:enabled-skills";
// 存"已种入过的默认 id 列表"（旧版本可能存的是字符串 "1"）
const SEED_KEY = "polaris:default-skills-seeded";
// 不再默认开启任何技能：新对话开箱即「干净」，技能一律由用户在「技能」面板手动开启。
// （保留 seed 机制以便将来按需补种，但当前默认集为空）
const DEFAULT_ON: string[] = [];

// 历史上默认自动开启过的技能 —— 老用户的 localStorage 里仍残留为「已激活」，
// 一次性清掉它们（只清这几个旧默认项，用户自己装/开的不动），让老安装也回到「无初始技能」。
const LEGACY_DEFAULTS = ["deep-research", "skill-creator", "cloak-browser", "browser-use"];
const PURGE_KEY = "polaris:legacy-defaults-purged.v1";

// storage 被禁用的 WebView 里,裸 localStorage 读写会在 store 初始化(setup 里的
// seedDefaults/purgeLegacyDefaults)时抛异常 → 整个应用挂不起来。统一走安全读写,绝不抛。
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* storage 不可用 */
  }
}

export const useSkillsStore = defineStore("skills", () => {
  const enabledSkills = ref<Set<string>>(new Set());

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        enabledSkills.value = new Set(arr);
      }
    } catch {
      enabledSkills.value = new Set();
    }
  }

  /**
   * 种入默认开启的技能。每个 id 只种一次：
   * 新加进 DEFAULT_ON 的默认项会在下次启动补种，但用户手动关掉的不会被重新打开。
   */
  function seedDefaults() {
    let seeded: string[] = [];
    try {
      const raw = localStorage.getItem(SEED_KEY);
      if (raw === "1") {
        seeded = ["cloak-browser"]; // 兼容旧版：当时只种过 cloak-browser
      } else if (raw) {
        seeded = JSON.parse(raw) as string[];
      }
    } catch {
      seeded = [];
    }

    const seededSet = new Set(seeded);
    const toSeed = DEFAULT_ON.filter((id) => !seededSet.has(id));
    if (toSeed.length === 0) return;

    const next = new Set(enabledSkills.value);
    toSeed.forEach((id) => {
      next.add(id);
      seededSet.add(id);
    });
    enabledSkills.value = next;
    saveToStorage();
    lsSet(SEED_KEY, JSON.stringify(Array.from(seededSet)));
  }

  function saveToStorage() {
    lsSet(STORAGE_KEY, JSON.stringify(Array.from(enabledSkills.value)));
  }

  function toggle(id: string) {
    const next = new Set(enabledSkills.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    enabledSkills.value = next;
    saveToStorage();
  }

  /** 显式启用（安装 / 创建后自动激活；幂等，不会重复触发） */
  function enable(id: string) {
    if (enabledSkills.value.has(id)) return;
    const next = new Set(enabledSkills.value);
    next.add(id);
    enabledSkills.value = next;
    saveToStorage();
  }

  function remove(id: string) {
    if (!enabledSkills.value.has(id)) return;
    const next = new Set(enabledSkills.value);
    next.delete(id);
    enabledSkills.value = next;
    saveToStorage();
  }

  function has(id: string): boolean {
    return enabledSkills.value.has(id);
  }

  /** 一次性清掉历史默认开启的技能（老安装迁移）：只动旧默认那几个，其余保留。 */
  function purgeLegacyDefaults() {
    if (lsGet(PURGE_KEY)) return;
    const next = new Set(enabledSkills.value);
    let changed = false;
    for (const id of LEGACY_DEFAULTS) {
      if (next.delete(id)) changed = true;
    }
    if (changed) {
      enabledSkills.value = next;
      saveToStorage();
    }
    lsSet(PURGE_KEY, "1");
  }

  // 初始化时加载 + 种入默认插件 + 清掉历史默认项
  loadFromStorage();
  seedDefaults();
  purgeLegacyDefaults();

  return {
    enabledSkills,
    toggle,
    enable,
    remove,
    has,
  };
});
