import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Identifies this build in the browser (the persisted query cache is discarded when it changes).
    // Vercel's system variables may not be exposed to the client, so fall back to the build time.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? String(Date.now()),
  },
  async headers() {
    return [
      {
        // On a first visit to /bengt, start the tournament request with the page itself instead of
        // after hydration; the dashboard's same-origin fetch then reuses the response. Only on the
        // HTML document: Next's prefetches and client navigations carry an RSC header, and a
        // preload there would fetch the tournament for every Bengt link merely shown on a page.
        source: '/bengt',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'Link', value: '</api/highdarts>; rel=preload; as=fetch; crossorigin=anonymous' }],
      },
    ];
  },
};

export default nextConfig;
