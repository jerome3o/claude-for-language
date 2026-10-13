/**
 * "A new version is available": on start (and from the menu) the app reads the
 * repo's GitHub releases and offers the newest `desktop-v*` one when it is
 * newer than this build. No auto-install: an unsigned app can't replace
 * itself safely, so Download opens the release page.
 */

import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { newerDesktopRelease, type ReleaseInfo } from '../../shared/desktop/bridge';
import { RELEASES_API } from './config';

export async function checkForUpdates(parent: BrowserWindow | null, interactive: boolean): Promise<void> {
  let releases: ReleaseInfo[];
  try {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    releases = (await res.json()) as ReleaseInfo[];
  } catch (err) {
    if (interactive) {
      const opts = { type: 'warning' as const, message: 'Couldn’t check for updates', detail: String((err as Error).message ?? err) };
      await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
    }
    return;
  }
  const newer = newerDesktopRelease(Array.isArray(releases) ? releases : [], app.getVersion());
  if (!newer) {
    if (interactive) {
      const opts = { type: 'info' as const, message: 'You’re up to date', detail: `Chinese Learning ${app.getVersion()} is the newest version.` };
      await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
    }
    return;
  }
  const opts = {
    type: 'info' as const,
    message: 'A new version is available',
    detail: `${newer.tag_name.replace('desktop-v', 'Version ')} is ready (you have ${app.getVersion()}). Download it, then replace the app in Applications.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
  if (response === 0) void shell.openExternal(newer.html_url);
}
