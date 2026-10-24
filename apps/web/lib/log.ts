import { formatEther } from 'viem';
import { Encounter, MAX_FLOOR, MONSTER_NAMES, Outcome, tierOf, type CombatEvent, type Resolution } from 'game-logic';

// Teks log (UI_UX §8, Indonesia santai). Versi kasar Phase 4; CombatLog Phase 5 di-drive timeline.

/** Format MON 3 desimal (CLAUDE.md). */
export function mon(wei: bigint): string {
  const [int, frac = ''] = formatEther(wei).split('.');
  return `${int}.${frac.padEnd(3, '0').slice(0, 3)}`;
}

export function monsterName(monsterId: number): string {
  return MONSTER_NAMES[monsterId] ?? 'Monster';
}

/** Nama zona kosmetik per tier (`tierOf(floor)`), dipakai landing dan narasi lantai. */
export const ZONE_NAMES = ['Lorong Atas', 'Gua Lumut', 'Katakomba', 'Jurang Abyss'] as const;

export function zoneName(floor: number): string {
  return ZONE_NAMES[tierOf(Math.max(1, floor))] ?? ZONE_NAMES[0];
}

// Pembuka per zona: suasana makin gelap seiring kedalaman.
const ZONE_INTROS: readonly (readonly string[])[] = [
  [
    'Tangga batu berderit di bawah sepatumu. Udara masih bau tanah basah.',
    'Obor di dinding masih menyala. Seseorang pernah lewat sini, belum lama.',
    'Tikus berlarian menjauh dari cahaya obormu.',
  ],
  [
    'Lumut hijau berpendar di dinding. Air menetes entah dari mana.',
    'Lantainya licin. Ada jejak kaki yang berhenti tiba-tiba.',
    'Gemericik air menutupi suara langkahmu. Juga langkah yang lain.',
  ],
  [
    'Tengkorak berjajar rapi di ceruk dinding. Beberapa seperti menoleh.',
    'Bau dupa dan debu. Nama-nama terukir di batu, sebagian masih baru.',
    'Obormu meredup sendiri. Katakomba tidak suka tamu.',
  ],
  [
    'Panas naik dari celah lantai. Batu di sini berwarna darah.',
    'Ada bisikan memanggil namamu. Padahal kamu tidak pernah menyebutkannya.',
    'Tangga ini tidak terlihat ujungnya. Hanya gelap, dan sesuatu yang bernapas.',
  ],
];

const FIRST_FLOOR = 'Pintu dungeon berdebam menutup di belakangmu. Satu-satunya jalan pulang: hidup-hidup.';
const LAST_FLOOR = 'Lantai terdalam. Di sini dungeon menyimpan semua yang pernah ia ambil.';

const ENCOUNTER_LINES: Record<number, readonly ((foe: string) => string)[]> = {
  [Encounter.MONSTER]: [
    (m) => `${m} menghadang jalanmu.`,
    (m) => `${m} muncul dari balik bayangan, matanya menyala.`,
    (m) => `Geraman pelan. ${m} sudah menunggumu dari tadi.`,
  ],
  [Encounter.TREASURE]: [
    () => 'Sebuah peti tergeletak di tengah ruangan.',
    () => 'Peti tua berdebu. Gemboknya sudah lama berkarat.',
    () => 'Kilau emas mengintip dari celah peti. Terlalu mudah?',
  ],
  [Encounter.TRAP]: [
    () => 'Lantai di depanmu terlihat… terlalu rapi.',
    () => 'Ada lubang-lubang kecil di dinding. Sejajar. Mencurigakan.',
    () => 'Satu ubin sedikit lebih tinggi dari yang lain.',
  ],
  [Encounter.MERCHANT]: [
    () => 'Pedagang tersenyum terlalu lebar.',
    () => 'Seorang pedagang menggelar dagangan di atas peti. "Mampir dulu, petualang."',
    () => 'Lentera kecil, tumpukan barang, dan pedagang yang entah bagaimana bisa sampai di sini.',
  ],
};

/** Pilih varian secara deterministik supaya kartu encounter dan log menampilkan teks yang sama. */
function pick<T>(list: readonly T[], salt: number): T {
  return list[Math.abs(salt) % list.length]!;
}

/** Kalimat encounter. `salt` (mis. runId + floor) memilih varian; tanpa salt = varian pertama. */
export function encounterLine(enc: number, monsterId: number, salt = 0): string {
  const lines = ENCOUNTER_LINES[enc];
  return lines ? pick(lines, salt)(monsterName(monsterId)) : '';
}

/** Narasi pembuka lantai: suasana zona + encounter (UI_UX §8). */
export function floorStory(floor: number, enc: number, monsterId: number, runId: bigint | number): string {
  const salt = Number(BigInt(runId) % 1000n) * 7 + floor;
  const intro =
    floor === 1 ? FIRST_FLOOR : floor >= MAX_FLOOR ? LAST_FLOOR : pick(ZONE_INTROS[tierOf(floor)] ?? ZONE_INTROS[0]!, salt);
  return `${intro} ${encounterLine(enc, monsterId, salt)}`;
}

export function combatLines(events: CombatEvent[], foe: string): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'potion':
        out.push(`Kamu minum potion (+${e.heal} HP, sekarang ${e.hpAfter}).`);
        break;
      case 'flee':
        out.push(e.ok ? `Kamu kabur! (peluang ${e.chance}%)` : `Gagal kabur (peluang ${e.chance}%). ${foe} menyerang duluan.`);
        break;
      case 'playerHit':
        out.push(`Kamu menyerang ${e.damage}${e.strong ? ' (kuat!)' : ''}. HP ${foe} ${e.hpAfter}.`);
        break;
      case 'monsterHit':
        out.push(`${foe} menyerang ${e.damage}${e.strong ? ' (kuat!)' : ''}. HP kamu ${e.hpAfter}.`);
        break;
      case 'win':
        out.push(`${foe} tumbang.`);
        break;
      case 'dead':
        out.push('Kamu tumbang.');
        break;
      case 'roundLimit':
        out.push('Kamu kehabisan tenaga setelah 64 ronde.');
        break;
    }
  }
  return out;
}

export function outcomeLine(res: Resolution, award: bigint): string {
  switch (res.outcome) {
    case Outcome.WIN:
    case Outcome.FLEE_FAIL_WIN:
      return `Menang! Loot +${mon(award)} MON.`;
    case Outcome.FLED:
      return 'Kamu lolos tanpa luka, tanpa loot.';
    case Outcome.TREASURE:
      return `Peti berisi ${mon(award)} MON.`;
    case Outcome.MIMIC_WIN:
      return `Peti itu… punya gigi. Tapi kamu menang: +${mon(award)} MON.`;
    case Outcome.TRAP_HP:
      return `Kamu menginjak tombol yang jelas-jelas mencurigakan. HP tinggal ${res.hpAfter}.`;
    case Outcome.TRAP_LOOT:
      return `Jebakan merobek tasmu. ${mon(res.bagLoss)} MON jatuh ke kegelapan.`;
    case Outcome.DISARM_OK:
      return `Jebakan dijinakkan. Salvage +${mon(award)} MON.`;
    case Outcome.DISARM_FAIL:
      return res.survived ? `Gagal menjinakkan. HP tinggal ${res.hpAfter}.` : 'Gagal menjinakkan. Jebakan itu fatal.';
    case Outcome.MIMIC_KILLED:
      return 'Peti itu… punya gigi. Dan lapar.';
    case Outcome.KILLED:
    case Outcome.FLEE_FAIL_KILLED:
      return 'Kamu tumbang.';
    default:
      return '';
  }
}

export function deathLine(floor: number, lost: bigint): string {
  return `Kamu mati di Lantai ${floor}. ${mon(lost)} MON kini milik dungeon.`;
}

export function cashOutLine(amount: bigint): string {
  return `Kamu keluar hidup-hidup membawa ${mon(amount)} MON.`;
}
