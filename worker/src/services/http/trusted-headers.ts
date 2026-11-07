/**
 * The headers a route forwards to a Durable Object (call room, group room, chat hub): the client's
 * own (Upgrade, Sec-WebSocket-*, …) WITHOUT any `X-*` header, so the trusted ones the route then sets
 * (X-User-Id, X-User-Picture, X-Instance, …) can never come from the client when the route leaves
 * one unset (security audit, Nov 2026).
 */
export function forwardableHeaders(raw: Headers): Headers {
  const out = new Headers();
  raw.forEach((value, name) => {
    if (!name.toLowerCase().startsWith('x-')) out.set(name, value);
  });
  return out;
}
