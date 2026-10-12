import { HighdartsDashboard } from '@/components/highdarts/Dashboard';

// A static shell: navigating here shows the cached tournament at once (or a skeleton on a first
// visit) instead of waiting for a server render. The dashboard loads and polls its own data.
//
// The tournament request is preloaded by a Link header on the HTML document (next.config.ts), not
// here: a preload in a server component (`preload()` or a rendered <link rel="preload">) becomes a
// hint in the page's payload, and it also runs when a link to this page is merely prefetched.
export default function BengtPage() {
  return <HighdartsDashboard />;
}
