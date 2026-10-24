// Keeper bot: relay reveal/settle yang macet + reapExpired (BUILD_PLAN Phase 3).
// Skeleton Phase 0: hanya validasi konfigurasi.

const REQUIRED = ['KEEPER_PRIVATE_KEY', 'DEPTHS_ADDRESS', 'RPC_HTTP'] as const;

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`keeper: env belum di-set: ${missing.join(', ')} (lihat apps/keeper/.env.example)`);
  process.exit(1);
}

console.log('keeper: belum diimplementasi (Phase 3)');
