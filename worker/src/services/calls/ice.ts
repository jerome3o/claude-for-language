/**
 * ICE servers for the call's RTCPeerConnection. STUN alone connects most
 * home / office networks; phones on carrier NAT and strict corporate Wi-Fi
 * need a TURN relay. With TURN_KEY_ID + TURN_KEY_API_TOKEN set (a Cloudflare
 * Realtime TURN key — free up to 1,000 GB a month) we mint short-lived TURN
 * credentials per call; without them the call is STUN-only.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const DEFAULT_STUN: IceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

export async function getIceServers(env: { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string }): Promise<{ iceServers: IceServer[]; turn: boolean }> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { iceServers: DEFAULT_STUN, turn: false };
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 6 * 3600 }),
    });
    if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServer | IceServer[] };
    const servers = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    // Browsers warn about (and some choke on) port-53 TURN URLs; drop them.
    const cleaned = servers.map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
    }));
    return { iceServers: [...DEFAULT_STUN, ...cleaned], turn: cleaned.length > 0 };
  } catch (err) {
    console.error('[calls] TURN credentials failed, falling back to STUN:', err);
    return { iceServers: DEFAULT_STUN, turn: false };
  }
}
