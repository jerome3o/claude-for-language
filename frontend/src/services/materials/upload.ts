/**
 * Add a material: register it, render its pages on this device, upload the
 * original and every page, then finish (the pages' text goes with it).
 */

import { completeMaterial, createMaterial, deleteMaterial, uploadOriginal, uploadPage, type MaterialInfo } from '../../api/materials';
import { materialFileProblem, materialKindOf, titleFromFileName } from '@shared/materials';
import { renderMaterial } from './render';
import { cachePageImage } from './cache';

export type UploadStage = { stage: 'rendering' | 'uploading'; done: number; total: number } | { stage: 'finishing' };

export async function addMaterial(file: File, opts: { title?: string; onProgress?: (s: UploadStage) => void } = {}): Promise<MaterialInfo> {
  const problem = materialFileProblem(file.name, file.type, file.size);
  if (problem) throw new Error(problem);
  const kind = materialKindOf(file.name, file.type)!;
  const rendered = await renderMaterial(file, kind, (done, total) => opts.onProgress?.({ stage: 'rendering', done, total }));
  const { material } = await createMaterial({ title: opts.title || titleFromFileName(file.name), file_name: file.name, mime_type: file.type || '', size: file.size });
  try {
    await uploadOriginal(material.id, file);
    for (const [i, p] of rendered.pages.entries()) {
      opts.onProgress?.({ stage: 'uploading', done: i, total: rendered.pages.length });
      await uploadPage(material.id, i, p.image);
      // My own material is on this device from the start (offline viewing).
      void cachePageImage(`/api/materials/${material.id}/pages/${i}/image`, p.image);
    }
    opts.onProgress?.({ stage: 'finishing' });
    const done = await completeMaterial(
      material.id,
      rendered.pages.map((p, index) => ({ index, text: p.text, notes: p.notes })),
      rendered.renderNote,
    );
    return done.material;
  } catch (err) {
    await deleteMaterial(material.id).catch(() => {});
    throw err;
  }
}
