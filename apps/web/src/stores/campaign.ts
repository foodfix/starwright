import { create } from 'zustand';
import {
  createNewCampaign,
  cryptoRng,
  migrateCampaignState,
  reduce,
  STATE_VERSION,
  type CampaignState,
  type EngineEvent,
  type NewCampaignInput,
  type Rng,
  type ReduceResult,
} from '@starwright/engine';
import type { StarforgedIndex } from '@starwright/data';
import { clearCampaign, loadCampaign, saveCampaign, saveCampaignNow } from '../persistence/db.js';

interface CampaignStore {
  index: StarforgedIndex | null;
  /** language of the loaded game data ('zh' for the pre-translated dataset) */
  dataLang: 'en' | 'zh';
  state: CampaignState | null;
  /** true when a saved campaign was restored from Dexie at boot */
  restored: boolean;
  /** execution context bound to this store, valid once index is set */
  executor: {
    index: StarforgedIndex;
    rng: Rng;
    getState(): CampaignState;
    replaceState(next: CampaignState): void;
  } | null;
  setIndex(index: StarforgedIndex, dataLang?: 'en' | 'zh'): Promise<void>;
  /** start a fresh campaign from the wizard (replaces any existing save) */
  startCampaign(input: NewCampaignInput): CampaignState;
  /** replace the in-memory campaign with an imported state (already migrated) */
  importState(state: CampaignState): void;
  /** restore the persisted campaign; returns false when none exists */
  restore(): Promise<boolean>;
  /** delete the save and return to the wizard */
  reset(): Promise<void>;
  executeEvent(event: EngineEvent): ReduceResult | null;
  /** DEBUG ONLY (settings.debug): replace the in-memory campaign state
   * directly, bypassing the engine reducer; persists like any other change */
  debugPatch(next: CampaignState): void;
}

export const useCampaign = create<CampaignStore>((set, get) => {
  let current: CampaignState | null = null;
  const rng: Rng = cryptoRng();
  return {
    index: null,
    dataLang: 'en',
    state: null,
    restored: false,
    executor: null,
    setIndex: async (index, dataLang) => {
      // Build the executor from the argument: reading get().index here would
      // observe the pre-set state and yield null on the first call.
      set({
        index,
        ...(dataLang ? { dataLang } : {}),
        executor: {
          index,
          rng,
          getState: () => current as CampaignState,
          replaceState: (next: CampaignState) => {
            current = next;
            set({ state: next });
            saveCampaign(next);
          },
        },
      });
      console.info('[starwright] engine executor ready');
      await get().restore();
    },
    startCampaign: (input) => {
      // index arrives with the input (M5) so asset meters/controls initialize
      current = createNewCampaign(input);
      console.info('[starwright] campaign started', {
        character: input.characterName,
        tracks: Object.keys(current.tracks),
        assets: current.assets.length,
      });
      set({ state: current, restored: true });
      void saveCampaignNow(current);
      return current;
    },
    importState: (state) => {
      current = state;
      console.info('[starwright] campaign imported', {
        version: state.version,
        character: state.characters[0]?.name,
      });
      set({ state: current, restored: true });
      void saveCampaignNow(current);
    },
    restore: async () => {
      if (current || !get().index) return false;
      const saved = await loadCampaign();
      console.info('[starwright] restore', { found: saved !== null, version: saved?.version });
      if (!saved) return false;
      try {
        // M5: older saves migrate (v1 → v2); future versions fail closed
        current = migrateCampaignState(saved);
      } catch (e) {
        console.warn('[starwright] save cannot be migrated', e);
        return false;
      }
      if (current.version !== STATE_VERSION) return false;
      set({ state: current, restored: true });
      return true;
    },
    reset: async () => {
      current = null;
      console.info('[starwright] campaign deleted, returning to wizard');
      await clearCampaign();
      set({ state: null, restored: false });
    },
    executeEvent: (event) => {
      const index = get().index;
      if (!index || !current) return null;
      const result = reduce(current, event, { index, rng });
      if (result.ok) {
        current = result.state;
        set({ state: current });
        saveCampaign(current);
      }
      return result;
    },
    debugPatch: (next) => {
      if (!current) return;
      current = next;
      set({ state: current });
      saveCampaign(current);
    },
  };
});
