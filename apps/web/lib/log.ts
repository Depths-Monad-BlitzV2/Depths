import { formatEther } from 'viem';
import { Encounter, MONSTER_NAMES, Outcome, type CombatEvent, type Resolution } from 'game-logic';

// Teks log (UI_UX §8, Indonesia santai). Versi kasar Phase 4; CombatLog Phase 5 di-drive timeline.

/** Format MON 3 desimal (CLAUDE.md). */
export function mon(wei: bigint): string {
  const [int, frac = ''] = formatEther(wei).split('.');
  return `${int}.${frac.padEnd(3, '0').slice(0, 3)}`;
}

export function monsterName(monsterId: number): string {
  return MONSTER_NAMES[monsterId] ?? 'Monster';
}

export function encounterLine(enc: number, monsterId: number): string {
  switch (enc) {
    case Encounter.MONSTER:
      return `${monsterName(monsterId)} menghadang jalanmu.`;
    case Encounter.TREASURE:
      return 'Sebuah peti tergeletak di tengah ruangan.';
    case Encounter.TRAP:
      return 'Lantai di depanmu terlihat… terlalu rapi.';
    case Encounter.MERCHANT:
      return 'Pedagang tersenyum terlalu lebar.';
    default:
      return '';
  }
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
