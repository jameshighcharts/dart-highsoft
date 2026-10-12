import { HighdartsDashboard } from '@/components/highdarts/Dashboard';

// A static shell: navigating here shows the cached tournament at once (or a skeleton on a first
// visit) instead of waiting for a server render. The dashboard loads and polls its own data.
export default function BengtPage() {
  return <HighdartsDashboard />;
}
