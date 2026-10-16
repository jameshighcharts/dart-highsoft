import type { NextConfig } from "next";

// Uploaded player pictures in Supabase Storage, which the image optimizer resizes (src/lib/avatars).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const avatarPattern = supabaseUrl?.protocol === 'https:'
  ? [{ protocol: 'https' as const, hostname: supabaseUrl.hostname, pathname: '/storage/v1/object/public/avatars/**' }]
  : [];

// Signed-in browsers get a Supabase token from /api/supabase-token (src/lib/server/supabaseToken);
// without a signing key there is none to preload.
const supabaseTokens = Boolean(process.env.SUPABASE_JWT_SIGNING_KEY?.trim());

const nextConfig: NextConfig = {
  images: {
    remotePatterns: avatarPattern,
    // 75 is the default; 85 for player photos (PHOTO_QUALITY in src/lib/imageAssets.ts).
    qualities: [75, 85],
    // Every optimized source changes URL when its content does (imported images are
    // content-hashed, uploads carry a ?v= version), so browsers and the CDN can keep the
    // results for a year instead of the default four hours.
    minimumCacheTTL: 31_536_000,
  },
  env: {
    // Identifies this build in the browser (the persisted query cache is discarded when it changes).
    // Vercel's system variables may not be exposed to the client, so fall back to the build time.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? String(Date.now()),
  },
  // Pages for one match, game, tournament or practising player are the same shell for every id,
  // prerendered once and served from the CDN; the client reads the id from the address
  // (useAddressId). beforeFiles: ahead of the app's own routes. /tournament/new is its own page.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/match/:id', destination: '/match/shell' },
        { source: '/game/:id', destination: '/game/shell' },
        { source: '/tournament/:id((?!new$)[^/]+)', destination: '/tournament/shell' },
        { source: '/practice/:playerId', destination: '/practice/shell' },
      ],
    };
  },
  // When a page is loaded (not navigated to in the app), start the requests it waits for with the
  // page itself instead of after hydration; the page's own same-origin fetches then reuse the
  // responses. Only on the HTML document: Next's prefetches and client navigations carry an RSC
  // header, and a preload there would run for every link to the page merely shown on screen.
  async headers() {
    const preload = (...paths: string[]) => [{
      key: 'Link',
      value: paths.map((path) => `<${path}>; rel=preload; as=fetch; crossorigin=anonymous`).join(', '),
    }];
    const documentOnly = [{ type: 'header' as const, key: 'rsc' }];
    // Every page's Supabase queries wait for the token.
    const token = supabaseTokens ? ['/api/supabase-token'] : [];
    // A later rule's Link replaces an earlier one's for the same page, so each page's rule lists all.
    return [
      ...(token.length > 0
        // Not the sign-in pages, which never ask for a token.
        ? [{ source: '/((?!api/|_next/|login$|signin$|.*\\.).*)', missing: documentOnly, headers: preload(...token) }]
        : []),
      { source: '/bengt', missing: documentOnly, headers: preload(...token, '/api/highdarts') },
      { source: '/new', missing: documentOnly, headers: preload(...token, '/api/highdarts', '/api/scolia/boards/available') },
      { source: '/tournament/new', missing: documentOnly, headers: preload(...token, '/api/scolia/boards/available') },
    ];
  },
};

export default nextConfig;
