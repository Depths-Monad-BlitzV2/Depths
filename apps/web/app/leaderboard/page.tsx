import type { Metadata } from 'next';
import { Leaderboard } from '@/components/feed/Leaderboard';

export const metadata: Metadata = {
  title: 'Depths — Leaderboard',
};

export default function LeaderboardPage() {
  return <Leaderboard />;
}
