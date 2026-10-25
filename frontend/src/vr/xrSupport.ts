/**
 * Can this browser enter immersive VR? (`navigator.xr.isSessionSupported('immersive-vr')`.)
 * The Steam Frame's stock browser and most phones say no — the page then is the flat preview,
 * with a pointer to docs/VR.md for a WebXR-capable browser.
 */
export type XrSupport =
  | { status: 'checking' }
  | { status: 'immersive' }
  | { status: 'none'; reason: string };

export async function detectXrSupport(nav: Pick<Navigator, 'xr'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<XrSupport> {
  const xr = nav?.xr;
  if (!xr) {
    return {
      status: 'none',
      reason: typeof window !== 'undefined' && !window.isSecureContext
        ? 'WebXR needs a secure (https) page.'
        : 'This browser has no WebXR, so it can’t open VR.',
    };
  }
  try {
    if (await xr.isSessionSupported('immersive-vr')) return { status: 'immersive' };
    return { status: 'none', reason: 'This browser has WebXR but can’t start immersive VR (no headset, or not enabled).' };
  } catch {
    return { status: 'none', reason: 'This browser can’t check for VR (WebXR is blocked here).' };
  }
}
