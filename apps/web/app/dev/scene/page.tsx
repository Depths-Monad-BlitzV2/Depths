import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { ScenePreview } from './ScenePreview';

// Pratinjau DungeonScene untuk QA visual (development saja). Contoh:
//   /dev/scene?floor=7&enc=1&mid=8&mode=battle&freeze=3
export default function DevScenePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense>
      <ScenePreview />
    </Suspense>
  );
}
