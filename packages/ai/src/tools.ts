import type { ToolSpec } from './types.js';

export const TOOL_NAMES = {
  makeMove: 'make_move',
  rollOracle: 'roll_oracle',
  getMoveDetail: 'get_move_detail',
  getOracleDetail: 'get_oracle_detail',
  adjustMeter: 'adjust_meter',
  adjustMomentum: 'adjust_momentum',
  burnMomentum: 'burn_momentum',
  markImpact: 'mark_impact',
  clearImpact: 'clear_impact',
  addTrack: 'add_track',
  swearVow: 'swear_vow',
  markProgress: 'mark_progress',
  adjustLegacy: 'adjust_legacy',
  updateTrack: 'update_track',
  fulfillVow: 'fulfill_vow',
  forsakeVow: 'forsake_vow',
  forgeBond: 'forge_bond',
  markBondDecrease: 'mark_bond_decrease',
  addAsset: 'add_asset',
  discardAsset: 'discard_asset',
  enableAbility: 'enable_ability',
  adjustAssetMeter: 'adjust_asset_meter',
  setAssetControl: 'set_asset_control',
  setFlag: 'set_flag',
  addJournalEntry: 'add_journal_entry',
  endScene: 'end_scene',
} as const;

const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

const RANKS = ['troublesome', 'dangerous', 'formidable', 'extreme', 'epic'] as const;
const METERS = ['health', 'spirit', 'supply'] as const;

const rollSelection = {
  stat: {
    ...enumSchema(['edge', 'heart', 'iron', 'shadow', 'wits']),
    description: 'Stat to roll with (choose exactly one of stat/meter).',
  },
  meter: {
    ...enumSchema(METERS),
    description: 'Condition meter to roll with (choose exactly one of stat/meter).',
  },
  add: {
    type: 'integer',
    description: 'Optional adds (-10..10) from assets, companions or circumstances.',
  },
} as const;

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.makeMove,
      description:
        'Resolve a triggered move (all 12 move categories). Pick move_id from the catalog and pass the selection its trigger demands (stat, meter, add or track_id — see get_move_detail). Invalid selections are rejected with the valid options. The engine rolls the dice and returns the authoritative outcome; embedded oracle tables are rolled automatically, or choose one with oracle_id (e.g. the odds table for Ask the Oracle).',
      parameters: {
        type: 'object',
        properties: {
          move_id: {
            type: 'string',
            description: 'Move id from the catalog, e.g. starforged/moves/adventure/face_danger',
          },
          ...rollSelection,
          add: {
            type: 'integer',
            description:
              'Adds from assets, companions or circumstances (-10..10). Some moves roll only +add (e.g. Develop Your Relationship adds the connection rank 1-5).',
          },
          track_id: {
            type: 'string',
            description:
              'Required for progress-roll moves: the track id to roll against. Legacy moves roll legacy tracks automatically.',
          },
          asset_id: {
            type: 'string',
            description:
              'Asset instance id (from the ASSETS snapshot line) for moves that roll with an asset meter, e.g. Companion Takes a Hit rolls +companion health, Withstand Damage rolls +integrity.',
          },
          oracle_id: {
            type: 'string',
            description:
              "Optional: choose one of the move's embedded oracle tables, e.g. an Ask the Oracle odds table (small_chance/unlikely/fifty_fifty/likely/almost_certain).",
          },
        },
        required: ['move_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.rollOracle,
      description:
        'Roll an oracle table by id (from the catalog). Returns the d100 roll, the row text (nested tables already rolled) and a match flag.',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'string',
            description: 'Oracle table id, e.g. starforged/oracles/core/action',
          },
        },
        required: ['table_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.getMoveDetail,
      description:
        'Read the full text of a move: trigger conditions, roll options and outcome texts. Read-only.',
      parameters: {
        type: 'object',
        properties: { move_id: { type: 'string' } },
        required: ['move_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.getOracleDetail,
      description: 'Read the full row list of an oracle table. Read-only.',
      parameters: {
        type: 'object',
        properties: { table_id: { type: 'string' } },
        required: ['table_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.adjustMeter,
      description:
        'Change a condition meter (health/spirit/supply, 0-5). Positive delta is recovery and is refused while a blocking impact is marked.',
      parameters: {
        type: 'object',
        properties: {
          meter: enumSchema(METERS),
          delta: { type: 'integer', description: 'Non-zero integer delta.' },
        },
        required: ['meter', 'delta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.adjustMomentum,
      description:
        'Adjust momentum by a non-zero delta; clamped to [-6, max]. Max = 10 minus active impacts.',
      parameters: {
        type: 'object',
        properties: { delta: { type: 'integer' } },
        required: ['delta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.burnMomentum,
      description:
        'Burn positive momentum to replace the score of a previous action roll this session (roll_id from the outcome). Momentum resets afterwards. The player chooses to burn; propose it before calling.',
      parameters: {
        type: 'object',
        properties: { roll_id: { type: 'string' } },
        required: ['roll_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.markImpact,
      description:
        'Mark a suffering impact (e.g. wounded, shaken, unprepared). Vehicle troubles require asset_id.',
      parameters: {
        type: 'object',
        properties: {
          impact_id: { type: 'string' },
          asset_id: { type: 'string', description: 'Required for vehicle troubles.' },
        },
        required: ['impact_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.clearImpact,
      description: 'Clear a marked impact (permanent ones are refused).',
      parameters: {
        type: 'object',
        properties: { impact_id: { type: 'string' } },
        required: ['impact_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.addTrack,
      description: 'Create a progress track (fray, expedition, connection or other scene tracks).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          rank: {
            ...enumSchema(RANKS),
            description: 'Challenge rank, or null for rankless tracks.',
          },
          kind: enumSchema(['vow', 'fray', 'expedition', 'connection', 'other']),
        },
        required: ['title', 'rank'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.swearVow,
      description: 'Swear an Iron Vow: creates a vow progress track with the given challenge rank.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short vow phrasing.' },
          rank: enumSchema(RANKS),
        },
        required: ['title', 'rank'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.markProgress,
      description: 'Mark progress on a track (one mark by default; the rank determines ticks).',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string' },
          marks: { type: 'integer', description: 'Number of progress marks (1-10), default 1.' },
        },
        required: ['track_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.adjustLegacy,
      description:
        'Mark ticks on a legacy track (quests/bonds/discoveries). Positive ticks automatically grant experience per filled box (Earn Experience). Negative ticks reduce the track (e.g. a bond is lost).',
      parameters: {
        type: 'object',
        properties: {
          legacy: enumSchema(['quests_legacy', 'bonds_legacy', 'discoveries_legacy']),
          ticks: { type: 'integer', description: 'Non-zero integer, -40..40.' },
        },
        required: ['legacy', 'ticks'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.updateTrack,
      description:
        'Revise a track per move text: clear boxes on a miss-recommit (explicit ticks), raise the rank, or rename.',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string' },
          title: { type: 'string' },
          rank: { ...enumSchema(RANKS), description: 'New challenge rank.' },
          ticks: { type: 'integer', description: 'Explicit ticks value 0-40 (overwrites).' },
        },
        required: ['track_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.fulfillVow,
      description:
        'Fulfill Your Vow: rolls the challenge dice against the vow track. On a hit it awards the quests legacy reward per rank and removes the track. On a miss nothing is awarded; offer the player to forsake or recommit (update_track).',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string', description: 'The vow track id.' },
          reward: {
            ...enumSchema(['full', 'one_rank_lower']),
            description:
              "Weak hit: 'full' if the player re-swears to set things right, otherwise 'one_rank_lower'. Strong hits always use full.",
          },
        },
        required: ['track_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.forsakeVow,
      description:
        'Forsake Your Vow: removes the vow track (clear the vow). Then apply the narrative cost with other tools (e.g. endure_stress, discard_asset).',
      parameters: {
        type: 'object',
        properties: { track_id: { type: 'string' } },
        required: ['track_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.forgeBond,
      description:
        'Forge a Bond: rolls against the connection track. Strong hit (or weak hit with confirmed=true after the request is fulfilled) awards the bonds legacy reward per rank and removes the track. On a miss offer to recommit (update_track).',
      parameters: {
        type: 'object',
        properties: {
          track_id: { type: 'string', description: 'The connection track id.' },
          confirmed: {
            type: 'boolean',
            description: 'Weak hit only: true when the connection asked something and it was done.',
          },
        },
        required: ['track_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.markBondDecrease,
      description:
        'A bond is lost or diminished: reduce the bonds legacy track by the given ticks.',
      parameters: {
        type: 'object',
        properties: { ticks: { type: 'integer', description: 'Positive integer 1-40.' } },
        required: ['ticks'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.addAsset,
      description:
        'Gain an asset. Buying via the Advance move costs 3 experience (pay_with_experience=true); narrative gifts are free. Modules should attach to a vehicle instance (attach_to).',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: 'Asset id from the catalog.' },
          pay_with_experience: {
            type: 'boolean',
            description: 'true to pay the 3 XP Advance cost; omitted/free otherwise.',
          },
          attach_to: {
            type: 'string',
            description: 'Vehicle instance id to attach this module to (e.g. the starship).',
          },
        },
        required: ['asset_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.discardAsset,
      description:
        'Discard an asset instance (destroyed vehicle, dead companion, abandoned path). Its impacts (e.g. battered) are cleared with it.',
      parameters: {
        type: 'object',
        properties: { asset_id: { type: 'string', description: 'Asset instance id.' } },
        required: ['asset_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.enableAbility,
      description:
        'Unlock a disabled asset ability. Advance upgrade costs 2 experience (pay_with_experience=true). Narrative requirements must be confirmed (requirement_confirmed=true) after verifying them in the fiction.',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: 'Asset instance id.' },
          ability_index: { type: 'integer', description: 'Ability index (0-2).' },
          pay_with_experience: { type: 'boolean', description: 'true to pay the 2 XP cost.' },
          requirement_confirmed: {
            type: 'boolean',
            description: 'true when the asset narrative requirement holds in the fiction.',
          },
        },
        required: ['asset_id', 'ability_index'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.adjustAssetMeter,
      description:
        "Change an asset condition meter (companion health, vehicle integrity, shields). Raising a vehicle's integrity is refused while battered.",
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: 'Asset instance id.' },
          control: { type: 'string', description: 'Meter key, e.g. health/integrity/shields.' },
          delta: { type: 'integer', description: 'Non-zero integer delta.' },
        },
        required: ['asset_id', 'control', 'delta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.setAssetControl,
      description:
        'Toggle an asset checkbox/flip control (e.g. out_of_action, broken, active). Impact checkboxes (battered/cursed) use mark_impact/clear_impact instead.',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: 'Asset instance id.' },
          control: { type: 'string', description: 'Control key.' },
          value: { type: 'boolean' },
        },
        required: ['asset_id', 'control', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.setFlag,
      description: 'Store a scene flag (arbitrary key/value) for narrative continuity.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {
            description:
              'JSON value (string, number, boolean, null, array or object). Pass objects and arrays as real JSON structures — never as JSON-encoded strings.',
          },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.addJournalEntry,
      description: 'Append a note to the campaign journal (session recap, turning points).',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.endScene,
      description: 'End the current scene and start the next one.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
];
