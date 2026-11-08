// Request guards for a lab that can ask a gateway the operator names (Real mode).
//  1. Bind loopback only, unless AGG_ENT_BIND is set (an explicit opt-in).
//  2. Reject any request whose Host header is not a loopback name (DNS-rebinding guard), unless it is listed in
//     LAB_ALLOWED_HOSTS or AGG_ENT_ALLOWED_HOSTS (family standard, comma separated) or is the AGG_ENT_BIND address.
//  3. Every state-changing API call (anything but GET/HEAD) must carry an Origin whose host is exactly the Host header, or the
//     lab-proxy's forwarded origin when Host is one of the listed names (see sameOriginWrites).
// Loopback helper adapted from hostile-mcp server/src/safety.js (MIT, same author).

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.AGG_ENT_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.AGG_ENT_BIND) return host;
  throw new Error(`refusing to bind ${host}: this lab can call a gateway you name and listens on loopback only. Set AGG_ENT_BIND to opt in.`);
}

// "host:port" or "[::1]:port" or "host" -> bare host name.
function hostName(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

export function allowedHostNames(env = process.env) {
  const extra = [env.AGG_ENT_ALLOWED_HOSTS, env.LAB_ALLOWED_HOSTS].flatMap((v) => String(v || '').split(',')).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (env.AGG_ENT_BIND && env.AGG_ENT_BIND !== '0.0.0.0' && env.AGG_ENT_BIND !== '::') extra.push(env.AGG_ENT_BIND.toLowerCase());
  return extra;
}

export function hostCheck(env = process.env) {
  const allowed = new Set(allowedHostNames(env));
  return (req, res, next) => {
    const name = hostName(req.headers.host);
    if (name && (isLoopbackHost(name) || allowed.has(name))) return next();
    return res.status(403).json({ error: 'bad_host', message: 'This lab answers only to a loopback Host header. Set LAB_ALLOWED_HOSTS to allow another.' });
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Behind the lab-proxy the browser's Origin is the proxy's (https://local.ping-devops.com:8443) while Host is this app's own name.
// The proxy sets X-Forwarded-Host/-Proto; they are believed only when Host is one of the operator-listed names (loopback does not
// count), so a request that did not come through the proxy cannot use them.
export function sameOriginWrites(env = process.env) {
  const allowed = new Set(allowedHostNames(env));
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.headers.origin;
    let ok = false;
    try { ok = Boolean(origin) && new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { ok = false; }
    if (!ok && origin) {
      const xfh = String(req.headers['x-forwarded-host'] || '').trim().toLowerCase();
      const xfp = String(req.headers['x-forwarded-proto'] || 'https').trim().toLowerCase();
      ok = allowed.has(hostName(req.headers.host)) && xfh !== '' && (xfp === 'https' || xfp === 'http') && origin === `${xfp}://${xfh}`
        && String(req.headers['sec-fetch-site'] || '').toLowerCase() !== 'cross-site';
    }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'State-changing calls must come from this tool\'s own page (Origin must match Host).' });
    return next();
  };
}
