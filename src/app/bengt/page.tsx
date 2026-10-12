import { HighdartsDashboard } from '@/components/highdarts/Dashboard';

// A static shell: navigating here shows the cached tournament at once (or a skeleton on a first
// visit) instead of waiting for a server render. The dashboard loads and polls its own data.
//
// No preload of /api/highdarts here: a preload in a server component (`preload()` or a rendered
// <link rel="preload">) becomes a hint in the page's payload, and it also runs when a link to this
// page is merely prefetched, so every page showing a Bengt link fetched the tournament for nothing.
export default function BengtPage() {
  return <HighdartsDashboard />;
}
