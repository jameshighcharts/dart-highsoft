import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Identifies this build in the browser (the persisted query cache is discarded when it changes).
    // Vercel's system variables may not be exposed to the client, so fall back to the build time.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? String(Date.now()),
  },
};

export default nextConfig;
