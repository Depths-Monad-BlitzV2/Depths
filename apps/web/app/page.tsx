import { MAX_FLOOR, MONSTER_NAMES, monster } from "game-logic";

// Placeholder Phase 0. Landing sebenarnya dibangun di Phase 5 (UI_UX §3.1).
export default function Home() {
  const deepest = monster(MAX_FLOOR);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-widest">DEPTHS</h1>
      <p>Bayar masuk. Makin dalam, makin kaya.</p>
      <p className="text-sm opacity-60">
        Lantai {MAX_FLOOR}: {MONSTER_NAMES.at(-1)} menunggu dengan HP {deepest.hp}.
      </p>
    </main>
  );
}
