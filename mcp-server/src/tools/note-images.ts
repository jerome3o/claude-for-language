/**
 * Pictures on cards from the MCP server (worker routes/note-images.ts, shared/cards/note-image.ts):
 * `illustrate_deck` (estimate first with dry_run, then one picture per card without one) and
 * `illustrate_note` (one card, or Regenerate). Pictures are made in the signed-in user's OWN decks
 * only (the API checks ownership); a student's copy of a tutor's deck follows her picture by itself.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';
import { estimateIllustrateCost, NOTE_IMAGE_COST_USD } from '../../../shared/cards/note-image';

interface DeckIllustrateStatus {
  deck_id: string;
  deck_name: string;
  total: number;
  with_image: number;
  pending: number;
  failed: number;
  missing: number;
  estimate: { pictures: number; usd: number; label: string };
  illustrate_new: boolean;
  available: boolean;
}

const PLACEMENT =
  'The picture shows the MEANING (never any writing): with the English on meaning → hanzi cards, and on the answer side of hanzi → meaning and audio → hanzi cards.';

export function registerNoteImageTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'illustrate_deck',
    `Give the cards of one of the user's OWN decks a picture each (generated in the background, about $${NOTE_IMAGE_COST_USD.toFixed(2)} a picture; cards that already have one are skipped). ${PLACEMENT} Call with dry_run: true first to get the count and the cost (${estimateIllustrateCost(20).label} for 20 cards) and tell the user before drawing. illustrate_new turns the deck's "Illustrate new cards" switch on / off. A tutor's students' copies of the deck follow her pictures automatically.`,
    {
      deck_id: z.string().describe('One of the signed-in user\'s decks (list_decks)'),
      dry_run: z.boolean().optional().describe('Only report how many pictures it would draw and the cost'),
      illustrate_new: z.boolean().optional().describe('Also set the deck\'s "Illustrate new cards" switch'),
    },
    async ({ deck_id, dry_run, illustrate_new }) => guard(async () => {
      const path = `/api/decks/${encodeURIComponent(deck_id)}/illustrate`;
      if (typeof illustrate_new === 'boolean') await api.put(path, { illustrate_new });
      if (dry_run) {
        const s = await api.get<DeckIllustrateStatus>(path);
        return jsonResult({ ...s, message: `Dry run: ${s.estimate.label}. Nothing was drawn.` });
      }
      const res = await api.post<{ ready: number; pending: number; queued: number; status: DeckIllustrateStatus }>(path, {});
      return jsonResult({
        ...res,
        message: `${res.pending} picture(s) are being drawn in the background${res.ready ? `, ${res.ready} reused at once` : ''}. They appear on the cards over the next minutes.`,
      });
    }),
  );

  server.tool(
    'illustrate_note',
    `Draw a picture for ONE card (note) of the user's own decks, or a new one with regenerate: true (about $${NOTE_IMAGE_COST_USD.toFixed(2)}). ${PLACEMENT} remove: true takes the picture off.`,
    {
      note_id: z.string().describe('The note (search_notes / get_deck)'),
      regenerate: z.boolean().optional().describe('Draw a different picture even if it has one'),
      remove: z.boolean().optional().describe('Take the picture off instead'),
    },
    async ({ note_id, regenerate, remove }) => guard(async () => {
      const path = `/api/notes/${encodeURIComponent(note_id)}/image`;
      const res = remove
        ? await api.delete<{ note: unknown }>(path)
        : await api.post<{ note: { image_status: string | null } }>(`${path}/generate`, { regenerate: regenerate === true });
      return jsonResult(res);
    }),
  );
}
