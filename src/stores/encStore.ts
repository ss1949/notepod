import { create } from "zustand";
import { api } from "../lib/tauri";

interface EncState {
  // 单密码方案：加密状态 = 锁屏密码已设置且已解锁
  isEncryptionEnabled: boolean;      // MK 在内存中（已解锁）
  hasEncryptionConfig: boolean;      // lock_config 中有 salt（即设置了锁屏密码）
  isFirstRun: boolean;
  showEncWizard: boolean;

  checkEncStatus: () => Promise<void>;
  checkFirstRun: () => Promise<void>;
  setShowEncWizard: (show: boolean) => void;
  setEncryptionEnabled: (enabled: boolean) => void;
  setEncryptionUnlocked: (unlocked: boolean) => void;
}

export const useEncStore = create<EncState>((set) => ({
  isEncryptionEnabled: false,
  hasEncryptionConfig: false,
  isFirstRun: false,
  showEncWizard: false,

  // 检查加密状态（单密码方案：加密已配置 = 锁屏密码已设置）
  checkEncStatus: async () => {
    try {
      const status = await api.getEncStatus();
      set({
        hasEncryptionConfig: status.has_config,
        isEncryptionEnabled: status.enabled,
      });
    } catch {
      set({ isEncryptionEnabled: false, hasEncryptionConfig: false });
    }
  },

  // 检查是否首次运行（未设置锁屏密码）
  checkFirstRun: async () => {
    try {
      const config = await api.getLockConfig();
      set({ isFirstRun: config === null });
      if (config === null) {
        set({ showEncWizard: true });
      }
    } catch {
      set({ isFirstRun: true, showEncWizard: true });
    }
  },

  setShowEncWizard: (show) => set({ showEncWizard: show }),
  setEncryptionEnabled: (enabled) => set({ isEncryptionEnabled: enabled }),
  setEncryptionUnlocked: (unlocked) => set({ isEncryptionEnabled: unlocked }),
}));
