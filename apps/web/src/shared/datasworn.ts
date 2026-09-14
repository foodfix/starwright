import type {
  AnyNode,
  Asset,
  Move,
  MoveCategory,
  AssetCategory,
  OracleRollable,
  Truth,
} from '@starwright/data';

export interface DataswornSegment {
  kind: 'text' | 'strong' | 'link' | 'table';
  text: string;
  /** target node id for link segments; oracle table id for table segments */
  id?: string;
}

const PATTERN = /__(.+?)__|\[([^\]]+)\]\(id:([^)]+)\)|\{\{table:([^}]+)\}\}/g;

/**
 * Split Datasworn rich text into display segments:
 * - `__bold__` → strong
 * - `[label](id:node_id)` → link segment (label kept, node id attached for a title)
 * - `{{table:oracle_id}}` → table segment (oracle id attached; interactive hosts render it)
 * - everything else stays plain text
 */
export function parseDatasworn(text: string): DataswornSegment[] {
  const segments: DataswornSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ kind: 'text', text: text.slice(last, index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: 'strong', text: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: 'link', text: match[2], id: match[3] });
    } else {
      segments.push({ kind: 'table', text: '', id: match[4]?.trim() });
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', text: text.slice(last) });
  }
  return segments;
}

/**
 * Convert rich text to the markdown subset rendered by `Markdown`:
 * `__bold__` is already markdown bold, id-links reduce to their label,
 * table placeholders are dropped, newlines (and `*` lists) are preserved.
 */
export function dataswornToMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(id:[^)]+\)/g, '$1')
    .replace(/\{\{table:[^}]+\}\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Definition summary cap so tooltips stay readable. */
const SUMMARY_LIMIT = 400;

/**
 * Markdown hover definition for an indexed node: name + converted summary.
 * Summary source depends on node kind (move text, oracle summary, first asset
 * ability, category summary); nodes without one degrade to the bare name.
 */
export function describeDataswornNodeMarkdown(node: AnyNode): string {
  const name = node.name || node._id;
  // zod looseObject members all carry an index signature, so discriminant
  // narrowing by `in`/`===` degrades; read the kind structurally instead
  const kind: string | undefined = (node as { type?: string }).type;
  let detail = '';
  if (kind === 'move') {
    const move = node as Move;
    detail = move.text ?? move.trigger?.text ?? '';
  } else if (kind === 'oracle_rollable') {
    detail = (node as OracleRollable).summary ?? '';
  } else if (kind === 'asset') {
    const asset = node as Asset;
    const ability = asset.abilities.find((a) => a.enabled) ?? asset.abilities[0];
    detail = ability?.text ?? '';
  } else if (kind === 'move_category' || kind === 'asset_collection') {
    const category = node as MoveCategory | AssetCategory;
    detail = category.summary ?? category.description ?? '';
  } else if (kind === undefined) {
    // truth node (no type field): the definitions live in its options
    const truth = node as Truth;
    detail = truth.your_character ?? truth.options[0]?.summary ?? '';
  }
  const md = dataswornToMarkdown(detail);
  const clipped = md.length > SUMMARY_LIMIT ? `${md.slice(0, SUMMARY_LIMIT)}…` : md;
  return clipped ? `${name}\n\n${clipped}` : name;
}
