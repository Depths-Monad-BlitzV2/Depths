import type { Metadata } from 'next';
import { PlayScreen } from '@/components/game/PlayScreen';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Depths — Play',
};

export default function PlayPage() {
  return (
    <Providers>
      <PlayScreen />
    </Providers>
  );
}
