import { describe, expect, it } from 'vitest';
import { STATE_VERSION, type CampaignState } from '@starwright/engine';
import { buildSaveFile, parseSaveFile, saveFileName } from './saveFile.js';

function v2State(): CampaignState {
  return {
    version: STATE_VERSION,
    truths: { cataclysm: '0' },
    characters: [
      {
        id: 'char-1',
        name: 'Raven',
        background: 'Raised in the Terminus quarries.',
        stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
        meters: { health: 5, spirit: 5, supply: 5 },
        impacts: [],
      },
    ],
    activeCharacterId: 'char-1',
    tracks: {},
    legacy: {
      quests_legacy: { ticks: 4, cleared: false },
      bonds_legacy: { ticks: 0, cleared: false },
      discoveries_legacy: { ticks: 0, cleared: false },
    },
    assets: [
      {
        id: 'asset-1',
        assetId: 'starforged/assets/command_vehicle/starship',
        enabledAbilities: [0],
        optionValues: {},
        meters: { integrity: 5 },
        controls: {},
      },
    ],
    experience: 6,
    contentFlags: [],
    scene: { index: 1, flags: {}, aboardVehicleAssetIds: ['asset-1'] },
    journal: [],
    momentum: 2,
    seq: 1,
  };
}

const chat = {
  entries: [{ kind: 'user', id: 1, text: 'hello' }],
  history: [{ role: 'user', content: 'hello' }],
  toolLog: [],
  usage: { promptTokens: 120, completionTokens: 30 },
};

describe('buildSaveFile / parseSaveFile round trip', () => {
  it('survives a JSON serialize → parse cycle unchanged', () => {
    const file = buildSaveFile(v2State(), chat, '2026-09-15T00:00:00.000Z');
    const parsed = parseSaveFile(JSON.parse(JSON.stringify(file)));
    expect(parsed).toEqual({ ok: true, campaign: v2State(), chat });
  });

  it('allows exporting without a chat stream', () => {
    const parsed = parseSaveFile(JSON.parse(JSON.stringify(buildSaveFile(v2State(), null))));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.chat).toBeNull();
  });

  it('accepts the legacy starforge-save kind marker on import', () => {
    const file = buildSaveFile(v2State(), chat);
    const legacy = JSON.parse(JSON.stringify(file)) as SaveFileLike;
    (legacy as Record<string, unknown>)['kind'] = 'starforge-save';
    const parsed = parseSaveFile(legacy);
    expect(parsed).toEqual({ ok: true, campaign: v2State(), chat });
  });

  it('migrates a v1 campaign through the engine migration chain on import', () => {
    const file = buildSaveFile(v2State(), chat);
    const v1 = JSON.parse(JSON.stringify(file)) as SaveFileLike;
    v1.campaign.version = 1;
    delete (v1.campaign as Record<string, unknown>)['experience'];
    (v1.campaign.assets[0] as Record<string, unknown>)['controls'] = undefined;
    const parsed = parseSaveFile(v1);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.campaign.version).toBe(STATE_VERSION);
      expect(parsed.campaign.experience).toBe(0);
      expect(parsed.campaign.assets[0]?.controls).toEqual({});
    }
  });

  it('normalizes a chat snapshot missing toolLog or usage', () => {
    const file = buildSaveFile(v2State(), null);
    const raw = JSON.parse(JSON.stringify(file)) as SaveFileLike;
    raw.chat = { entries: [], history: [] } as never;
    const parsed = parseSaveFile(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.chat?.toolLog).toEqual([]);
      expect(parsed.chat?.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    }
  });
});

describe('parseSaveFile rejects foreign input', () => {
  it('rejects arbitrary JSON with notSaveFile', () => {
    expect(parseSaveFile({ hello: 'world' })).toEqual({ ok: false, error: 'notSaveFile' });
    expect(parseSaveFile(null)).toEqual({ ok: false, error: 'notSaveFile' });
    expect(parseSaveFile([1, 2])).toEqual({ ok: false, error: 'notSaveFile' });
  });

  it('rejects a save whose campaign is malformed', () => {
    const file = buildSaveFile(v2State(), null);
    const raw = JSON.parse(JSON.stringify(file)) as SaveFileLike;
    raw.campaign = { version: 'two' } as never;
    expect(parseSaveFile(raw)).toEqual({ ok: false, error: 'badCampaign' });
  });

  it('rejects an unmigratable campaign version', () => {
    const file = buildSaveFile(v2State(), null);
    const raw = JSON.parse(JSON.stringify(file)) as SaveFileLike;
    raw.campaign.version = 99;
    expect(parseSaveFile(raw)).toEqual({ ok: false, error: 'cannotMigrate' });
  });

  it('rejects a save with an invalid chat stream', () => {
    const file = buildSaveFile(v2State(), chat);
    const raw = JSON.parse(JSON.stringify(file)) as SaveFileLike;
    raw.chat = { entries: 'nope', history: [] } as never;
    expect(parseSaveFile(raw)).toEqual({ ok: false, error: 'badChat' });
  });
});

describe('saveFileName', () => {
  it('formats the export timestamp', () => {
    expect(saveFileName(new Date('2026-09-15T07:08:00'))).toBe('starwright-save-20260915-0708.json');
  });
});

type SaveFileLike = {
  campaign: Record<string, unknown> & { version: number; assets: unknown[] };
  chat: unknown;
};
