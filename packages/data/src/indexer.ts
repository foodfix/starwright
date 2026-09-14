import type { Starforged } from './schema/index.js';
import type { Move, MoveCategory, MoveRollType } from './schema/moves.js';
import type { OracleCollectionNode, OracleRollable, OracleRow } from './schema/oracles.js';
import type { Asset, AssetCategory } from './schema/assets.js';
import type { Truth } from './schema/truths.js';
import { preprocessRows, type PreprocessedOracleTable } from './oracle.js';

export type AnyNode = MoveCategory | Move | OracleCollectionNode | OracleRollable | AssetCategory | Asset | Truth;

export interface MoveCatalogEntry {
  id: string;
  name: string;
  rollType: MoveRollType;
}

export interface MoveCategoryNode {
  id: string;
  name: string;
  moves: MoveCatalogEntry[];
}

export interface AssetCatalogEntry {
  id: string;
  name: string;
  category: string;
  /** text of the always-on first ability */
  firstAbility: string;
  optionLabels: string[];
}

export interface AssetCategoryNode {
  id: string;
  name: string;
  assets: AssetCatalogEntry[];
}

export interface OracleTreeRollable {
  kind: 'rollable';
  id: string;
  name: string;
  breadcrumbs: string[];
}

export interface OracleTreeCollection {
  kind: 'collection';
  id: string;
  name: string;
  breadcrumbs: string[];
  contents: OracleTreeNode[];
}

export type OracleTreeNode = OracleTreeCollection | OracleTreeRollable;

export interface StarforgedIndex {
  readonly byId: ReadonlyMap<string, AnyNode>;
  readonly data: Starforged;
  getMove(id: string): Move | undefined;
  listMoves(): MoveCategoryNode[];
  getOracle(id: string): OracleRollable | undefined;
  getOracleRows(id: string): OracleRow[] | undefined;
  listOracleTree(): OracleTreeCollection[];
  getAsset(id: string): Asset | undefined;
  listAssetTree(): AssetCategoryNode[];
  getTruth(key: string): Truth | undefined;
  listTruths(): Truth[];
}

export interface BuiltIndex extends StarforgedIndex {
  tables: ReadonlyMap<string, PreprocessedOracleTable>;
}

/**
 * Data-gap correction: the Ask the Oracle move references five odds tables
 * (`starforged/oracles/moves/ask_the_oracle/*`) that do not exist as rollable
 * nodes in Datasworn 0.0.10. The odds are pure mechanics (Rules-Summary p6:
 * "The answer is yes if you roll ≤ 10/25/50/75/90"), so they are synthesized
 * here as yes/no tables — match handling stays with the caller.
 */
const ASK_THE_ORACLE_ODDS: ReadonlyArray<{ id: string; name: string; yesMax: number }> = [
  { id: 'small_chance', name: 'Ask the Oracle: Small Chance', yesMax: 10 },
  { id: 'unlikely', name: 'Ask the Oracle: Unlikely', yesMax: 25 },
  { id: 'fifty_fifty', name: 'Ask the Oracle: 50/50', yesMax: 50 },
  { id: 'likely', name: 'Ask the Oracle: Likely', yesMax: 75 },
  { id: 'almost_certain', name: 'Ask the Oracle: Almost Certain', yesMax: 90 },
];

export function buildIndex(data: Starforged): BuiltIndex {
  const byId = new Map<string, AnyNode>();
  const movesById = new Map<string, Move>();
  const oraclesById = new Map<string, OracleRollable>();
  const assetsById = new Map<string, Asset>();
  const truths = new Map<string, Truth>();
  const tables = new Map<string, PreprocessedOracleTable>();
  const moveTree: MoveCategoryNode[] = [];
  const oracleTree: OracleTreeCollection[] = [];
  const assetTree: AssetCategoryNode[] = [];

  const registerTable = (id: string, rows: OracleRow[]): void => {
    tables.set(id, { id, rows: preprocessRows(rows) });
  };

  for (const [key, category] of Object.entries(data.moves)) {
    byId.set(category._id, category);
    const moves: MoveCatalogEntry[] = [];
    for (const move of Object.values(category.contents)) {
      byId.set(move._id, move);
      movesById.set(move._id, move);
      moves.push({ id: move._id, name: move.name, rollType: move.roll_type });
    }
    moveTree.push({ id: category._id, name: category.name ?? key, moves });
  }

  const walkOracles = (
    node: OracleCollectionNode | OracleRollable,
    breadcrumbs: string[],
  ): OracleTreeNode => {
    byId.set(node._id, node);
    if (node.type === 'oracle_rollable') {
      oraclesById.set(node._id, node);
      registerTable(node._id, node.rows);
      return { kind: 'rollable', id: node._id, name: node.name, breadcrumbs: [...breadcrumbs] };
    }
    const children = Object.values(node.contents).map((child) =>
      walkOracles(child, [...breadcrumbs, node.name]),
    );
    const treeNode: OracleTreeCollection = {
      kind: 'collection',
      id: node._id,
      name: node.name,
      breadcrumbs: [...breadcrumbs],
      contents: children,
    };
    if (breadcrumbs.length === 0) oracleTree.push(treeNode);
    return treeNode;
  };
  for (const category of Object.values(data.oracles)) walkOracles(category, []);

  for (const category of Object.values(data.assets)) {
    byId.set(category._id, category);
    const entries: AssetCatalogEntry[] = [];
    for (const asset of Object.values(category.contents)) {
      byId.set(asset._id, asset);
      assetsById.set(asset._id, asset);
      entries.push({
        id: asset._id,
        name: asset.name,
        category: asset.category,
        firstAbility: asset.abilities[0]?.text ?? '',
        optionLabels: Object.values(asset.options ?? {}).map((option) => option.label),
      });
    }
    assetTree.push({ id: category._id, name: category.name, assets: entries });
  }

  // M5: embedded asset moves (e.g. Raise Shields) join the move catalog under a
  // synthetic "Assets" category so make_move resolves them like any other move.
  const embeddedMoves: MoveCatalogEntry[] = [];
  for (const asset of assetsById.values()) {
    for (const ability of asset.abilities) {
      const abilityMoves: Record<string, Move> = ability.moves ?? {};
      for (const move of Object.values(abilityMoves)) {
        if (movesById.has(move._id)) continue;
        byId.set(move._id, move);
        movesById.set(move._id, move);
        embeddedMoves.push({ id: move._id, name: move.name, rollType: move.roll_type });
      }
    }
  }
  if (embeddedMoves.length > 0) {
    moveTree.push({ id: 'starforged/moves/assets', name: 'Assets', moves: embeddedMoves });
  }

  for (const [key, truth] of Object.entries(data.truths)) {
    byId.set(truth._id, truth);
    truths.set(key, truth);
    for (const [optionKey, option] of truth.options.entries()) {
      if (option.table) {
        const syntheticId = `${truth._id}/${optionKey}`;
        const synthetic: OracleRollable = {
          _id: syntheticId,
          type: 'oracle_rollable',
          name: `${truth.name} (${option.summary})`,
          oracle_type: option.table.oracle_type,
          dice: option.table.dice,
          rows: option.table.rows,
        };
        byId.set(syntheticId, synthetic);
        oraclesById.set(syntheticId, synthetic);
        registerTable(syntheticId, option.table.rows);
      }
    }
  }

  for (const odds of ASK_THE_ORACLE_ODDS) {
    const syntheticId = `starforged/oracles/moves/ask_the_oracle/${odds.id}`;
    // localized datasets (e.g. starforged.zh.json) may ship these tables already
    if (byId.has(syntheticId)) continue;
    const synthetic: OracleRollable = {
      _id: syntheticId,
      type: 'oracle_rollable',
      name: odds.name,
      oracle_type: 'yes/no',
      dice: '2d10',
      rows: [
        { min: 1, max: odds.yesMax, text: 'Yes' },
        { min: odds.yesMax + 1, max: 100, text: 'No' },
      ],
    };
    byId.set(syntheticId, synthetic);
    oraclesById.set(syntheticId, synthetic);
    registerTable(syntheticId, synthetic.rows);
  }

  return {
    byId,
    tables,
    data,
    getMove: (id) => movesById.get(id),
    listMoves: () => moveTree,
    getOracle: (id) => oraclesById.get(id),
    getOracleRows: (id) => tables.get(id)?.rows,
    listOracleTree: () => oracleTree,
    getAsset: (id) => assetsById.get(id),
    listAssetTree: () => assetTree,
    getTruth: (key) => truths.get(key),
    listTruths: () => [...truths.values()],
  };
}
