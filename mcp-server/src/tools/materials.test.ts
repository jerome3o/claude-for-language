import { describe, expect, it } from 'vitest';
import { registerMaterialTools, trimMaterial } from './materials';
import type { ToolContext } from './context';

describe('material tools', () => {
  it('trims a material for a chat and reads page text through the API', async () => {
    expect(trimMaterial({ id: 'm1', title: '第五课', kind: 'pptx', status: 'ready', page_count: 12, has_text: true, mine: true, shared_with: ['rel-1'], render_note: 'Slides drawn…', updated_at: 0 })).toMatchObject({
      id: 'm1', pages: 12, shared_with_relationships: ['rel-1'], note: 'Slides drawn…', view_path: '/materials/m1',
    });
    const tools: Record<string, (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>> = {};
    const server = { tool: (name: string, _d: string, _s: unknown, fn: (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>) => void (tools[name] = fn) };
    const paths: string[] = [];
    const api = {
      get: async (p: string) => {
        paths.push(p);
        return p.startsWith('/api/materials/m1/text')
          ? { material: { id: 'm1', title: '第五课', kind: 'pptx', page_count: 12, render_note: null }, pages: [{ page: 2, text: '', notes: 'Ask for examples' }] }
          : { materials: [] };
      },
    };
    registerMaterialTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
    const out = await tools.read_material({ material_id: 'm1', from_page: 2, to_page: 3 });
    expect(paths).toEqual(['/api/materials/m1/text?from=2&to=3']);
    expect(JSON.parse(out.content[0].text).pages).toEqual([{ page: 2, text: '(no text on this page)', speaker_notes: 'Ask for examples' }]);
    await tools.list_materials({ relationship_id: 'rel-1' });
    expect(paths[1]).toBe('/api/materials?relationship_id=rel-1');
  });
});
