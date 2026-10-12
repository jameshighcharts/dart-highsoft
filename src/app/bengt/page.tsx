import { preload } from 'react-dom';

import { HighdartsDashboard } from '@/components/highdarts/Dashboard';

// A static shell: navigating here shows the cached tournament at once (or a skeleton on a first
// visit) instead of waiting for a server render. The dashboard loads and polls its own data.
export default function BengtPage() {
  // On a first visit, start the tournament request from the HTML, alongside the page's code,
  // instead of after hydration; the dashboard's same-origin fetch then reuses the response.
  preload('/api/highdarts', { as: 'fetch', crossOrigin: 'anonymous' });
  return <HighdartsDashboard />;
}
