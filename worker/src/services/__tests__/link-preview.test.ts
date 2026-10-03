import { describe, it, expect, vi } from 'vitest';
import { fetchLinkPreview, parseLinkPreview, safePreviewUrl } from '../link-preview';

describe('link previews', () => {
  it('refuses URLs that must not be fetched', () => {
    for (const u of ['ftp://x.com/a', 'http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.2/', 'http://172.20.0.1/',
      'http://169.254.169.254/latest', 'http://[::1]/', 'http://user:pw@x.com/', 'http://x.com:8080/', 'http://printer.local/', 'not a url', 'http://intranet/']) {
      expect(safePreviewUrl(u), u).toBeNull();
    }
    expect(safePreviewUrl('https://en.wikipedia.org/wiki/Tea')?.hostname).toBe('en.wikipedia.org');
    expect(safePreviewUrl('http://8.8.8.8/')).not.toBeNull();
  });

  it('reads Open Graph, falls back to Twitter / <title> / the host, and resolves the image', () => {
    const html = `<html><head><title>Ignored</title>
      <meta property="og:title" content="Chinese cuisine &amp; tea">
      <meta name='description' content='Plain description'>
      <meta property="og:description" content="Cuisines of China – a &quot;huge&quot; topic">
      <meta property="og:image" content="/img/dish.jpg"></head><body></body></html>`;
    expect(parseLinkPreview(html, 'https://www.example.com/food')).toEqual({
      url: 'https://www.example.com/food',
      title: 'Chinese cuisine & tea',
      description: 'Cuisines of China – a "huge" topic',
      image: 'https://www.example.com/img/dish.jpg',
      site_name: 'example.com',
    });
    expect(parseLinkPreview('<title> 汉语  学习 </title><meta name="twitter:image" content="javascript:alert(1)">', 'https://a.cn/')).toEqual({
      url: 'https://a.cn/', title: '汉语 学习', description: null, image: null, site_name: 'a.cn',
    });
    expect(parseLinkPreview('<p>no title</p>', 'https://a.cn/')).toBeNull();
  });

  it('fetches HTML, takes images as their own preview, and gives up quietly', async () => {
    const page = new Response('<head><meta property="og:title" content="Hi"><meta property="og:site_name" content="Site"></head>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const f = vi.fn(async () => page) as unknown as typeof fetch;
    expect(await fetchLinkPreview('https://x.com/a', f)).toMatchObject({ title: 'Hi', site_name: 'Site' });
    const img = vi.fn(async () => new Response('x', { headers: { 'Content-Type': 'image/png' } })) as unknown as typeof fetch;
    expect(await fetchLinkPreview('https://x.com/a.png', img)).toMatchObject({ image: 'https://x.com/a.png', title: null });
    expect(await fetchLinkPreview('https://x.com/a', vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLinkPreview('https://x.com/a', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
    const never = vi.fn();
    expect(await fetchLinkPreview('http://127.0.0.1/', never as unknown as typeof fetch)).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});
