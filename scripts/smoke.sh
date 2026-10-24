#!/usr/bin/env bash
# Smoke test Depths lewat CLI (`cast`), BUILD_PLAN Phase 3.
#
#   RPC_URL=https://testnet-rpc.monad.xyz DEPTHS=0x... PRIVATE_KEY=0x... bash scripts/smoke.sh
#
# PRIVATE_KEY = owner (main wallet). Session key (operator) dibuat baru setiap jalan, di-top-up lewat
# enterDungeon, lalu sisa saldonya dikembalikan ke owner di akhir.
#   Run 1, jalur normal  : enterDungeon → act → descend → act → cashOut
#   Run 2, jalur fallback: enterDungeon → reveal → act → settle → cashOut
# Setiap tx mencatat `cast estimate` (bahan kalibrasi lib/gas.ts), gas limit yang dipakai, dan latency.
# Env opsional: TOPUP (wei, default 0.1 MON), GAS_MARGIN_PCT (default 20), RUNS ("normal,fallback" default).
set -euo pipefail

# cast di Windows mencetak CRLF; buang \r supaya parsing konsisten di semua OS
cast() { command cast "$@" | tr -d '\r'; }

: "${RPC_URL:?set RPC_URL}" "${DEPTHS:?set DEPTHS}" "${PRIVATE_KEY:?set PRIVATE_KEY}"
TOPUP="${TOPUP:-100000000000000000}"
MARGIN="${GAS_MARGIN_PCT:-20}"
RUNS="${RUNS:-normal,fallback}"
OWNER=$(cast wallet address "$PRIVATE_KEY")
# output teks `cast wallet new` ke stderr, jadi ambil dari --json
OP_KEY=$(cast wallet new --json | grep -oE '"private_key":"0x[0-9a-fA-F]{64}"' | cut -d'"' -f4)
OP=$(cast wallet address "$OP_KEY")

RUN_SIG='getRun(address)((address,uint32,uint8,uint8,uint8,uint8,uint8,uint8,uint8,bool,uint16,uint16,uint16,uint8,uint64,uint128,bytes32))'
ENC_NAMES=(NONE MONSTER TREASURE TRAP MERCHANT)
STATE_NAMES=(NONE AWAIT_REVEAL AWAIT_ACTION AWAIT_SETTLE FLOOR_CLEARED)
OUTCOME_NAMES=(NONE WIN FLED FLEE_FAIL_WIN TREASURE MIMIC_WIN TRAP_HP TRAP_LOOT DISARM_OK DISARM_FAIL LEAVE BUY KILLED FLEE_FAIL_KILLED MIMIC_KILLED)

log() { printf '%s\n' "$*"; }
num() { sed 's/ \[[^]]*\]//g' | tr -d ' '; } # buang anotasi "[1e18]" dari output cast

# field ke-N (0-based) dari getRun(OWNER), urutan sesuai struct Run
run_field() {
  cast call --rpc-url "$RPC_URL" "$DEPTHS" "$RUN_SIG" "$OWNER" | tr -d '()' | sed 's/ \[[^]]*\]//g' |
    cut -d, -f$(($1 + 1)) | tr -d ' '
}
state() { run_field 2; }

# tunggu sampai block.number > targetBlock (blockhash target sudah ada)
wait_target() {
  local target bn
  target=$(run_field 14)
  while :; do
    bn=$(cast block-number --rpc-url "$RPC_URL")
    ((bn > target)) && break
    sleep 0.2
  done
}

# send <label> <key> <sig> [args...]: estimate → kirim dengan limit estimate+margin → cetak ringkasan
send() {
  local label=$1 key=$2 sig=$3
  shift 3
  local from est limit t0 t1 out status block
  from=$(cast wallet address "$key")
  est=$(cast estimate --rpc-url "$RPC_URL" --from "$from" "$DEPTHS" "$sig" "$@" ${VALUE:+--value "$VALUE"})
  limit=$((est * (100 + MARGIN) / 100))
  t0=$(date +%s%3N)
  out=$(cast send --rpc-url "$RPC_URL" --private-key "$key" --gas-limit "$limit" ${VALUE:+--value "$VALUE"} \
    "$DEPTHS" "$sig" "$@")
  t1=$(date +%s%3N)
  status=$(awk '$1 == "status" {print $2}' <<<"$out")
  block=$(awk '$1 == "blockNumber" {print $2}' <<<"$out")
  log "  tx $(printf '%-26s' "$label") estimate=$est limit=$limit status=$status block=$block latency=$((t1 - t0))ms"
  [[ $status == 1 ]] || { log "$out"; exit 1; }
}

show_encounter() {
  local out enc
  out=$(cast call --rpc-url "$RPC_URL" "$DEPTHS" 'previewEncounter(address)(uint8,uint8,bool,bool)' "$OWNER")
  enc=$(head -1 <<<"$out")
  log "  floor $(run_field 3): encounter ${ENC_NAMES[$enc]} (monsterId $(sed -n 2p <<<"$out"))" >&2
  echo "$enc"
}

# aksi aman untuk smoke test: FIGHT=1, OPEN=3, PROCEED=5 (tidak pernah fatal), LEAVE=4
action_for() { case $1 in 1) echo 1 ;; 2) echo 3 ;; 3) echo 5 ;; *) echo 4 ;; esac; }

show_resolve() {
  local out code
  out=$(cast call --rpc-url "$RPC_URL" "$DEPTHS" \
    'previewResolve(address)((uint8,bool,uint16,uint128,uint128),bytes32,bool,bool)' "$OWNER")
  code=$(head -1 <<<"$out" | tr -d '()' | cut -d, -f1 | tr -d ' ')
  log "  previewResolve: $(head -1 <<<"$out" | num) → ${OUTCOME_NAMES[$code]}"
}

# act [label]: pilih aksi dari encounter, kirim lewat operator
act_floor() {
  local enc a
  enc=$(show_encounter)
  a=$(action_for "$enc")
  send "${1:-act}" "$OP_KEY" 'act(uint8,uint8,uint8,uint8,bool)' "$a" 0 0 0 false
  if [[ $(state) == 3 ]]; then
    wait_target
    show_resolve
  fi
}

ensure_alive() {
  if [[ $(state) == 0 ]]; then
    log "  run mati (lihat RunDied di explorer). Jalankan ulang smoke test."
    exit 2
  fi
}

check_bal() { cast balance --rpc-url "$RPC_URL" "$1"; }
# aritmetika wei di luar batas int64 bash
big() { node -e "console.log(String($1))"; }

log "Depths $DEPTHS @ $RPC_URL"
log "owner $OWNER | operator (burner baru) $OP"
log "poolInfo: $(cast call --rpc-url "$RPC_URL" "$DEPTHS" 'poolInfo()(uint128,uint128,uint128,uint128)' | num | paste -sd' ')"
[[ $(state) == 0 ]] || { log "owner masih punya run aktif (state $(state)). Selesaikan dulu."; exit 1; }
FEE=$(cast call --rpc-url "$RPC_URL" "$DEPTHS" 'entryFee()(uint128)' | num)

# ------------------------------------------------------------------ run 1: jalur normal
if [[ $RUNS == *normal* ]]; then
log ""
log "== Run 1: jalur normal (2 tx per lantai)"
VALUE=$((FEE + TOPUP)) send enterDungeon "$PRIVATE_KEY" 'enterDungeon(address)' "$OP"
log "  runId $(run_field 1), burner balance $(check_bal "$OP") wei"
wait_target
act_floor "act (floor 1)"
ensure_alive
send "descend" "$OP_KEY" 'descend()'
ensure_alive
wait_target
act_floor "act (floor 2)"
ensure_alive
BAG=$(run_field 15)
BEFORE=$(check_bal "$OWNER")
send "cashOut" "$OP_KEY" 'cashOut()'
AFTER=$(check_bal "$OWNER")
[[ $(state) == 0 ]] || { log "  cashOut tidak menutup run (state $(state))"; exit 1; }
log "  bag sebelum settle $BAG wei; owner menerima $(big "BigInt('$AFTER') - BigInt('$BEFORE')") wei (payout ke owner, bukan operator)"
fi

# ------------------------------------------------------------------ run 2: jalur fallback
if [[ $RUNS == *fallback* ]]; then
log ""
log "== Run 2: jalur fallback (reveal / settle permissionless)"
VALUE=$((FEE + TOPUP)) send enterDungeon "$PRIVATE_KEY" 'enterDungeon(address)' "$OP"
# turun sampai ada aksi yang butuh settle (merchant = LEAVE instan, tidak menguji settle)
for _ in 1 2 3 4 5; do
  wait_target
  send "reveal (fallback)" "$PRIVATE_KEY" 'reveal(address)' "$OWNER"
  log "  state ${STATE_NAMES[$(state)]}"
  act_floor "act (AWAIT_ACTION)"
  if [[ $(state) == 3 ]]; then
    send "settle (fallback)" "$PRIVATE_KEY" 'settle(address)' "$OWNER"
    log "  state ${STATE_NAMES[$(state)]}"
    break
  fi
  send "descend (FLOOR_CLEARED)" "$OP_KEY" 'descend()'
done
ensure_alive
BEFORE=$(check_bal "$OWNER")
send "cashOut (FLOOR_CLEARED)" "$OP_KEY" 'cashOut()'
AFTER=$(check_bal "$OWNER")
log "  owner menerima $(big "BigInt('$AFTER') - BigInt('$BEFORE')") wei"
fi

# ------------------------------------------------------------------ bersih-bersih
log ""
GP=$(cast gas-price --rpc-url "$RPC_URL")
OPBAL=$(check_bal "$OP")
REFUND=$(big "BigInt('$OPBAL') - 21000n * BigInt('$GP')")
if [[ $REFUND != -* && $REFUND != 0 ]]; then
  cast send --rpc-url "$RPC_URL" --private-key "$OP_KEY" --gas-limit 21000 --gas-price "$GP" --value "$REFUND" \
    "$OWNER" >/dev/null
  log "sisa burner $REFUND wei dikembalikan ke owner"
fi
log "poolInfo: $(cast call --rpc-url "$RPC_URL" "$DEPTHS" 'poolInfo()(uint128,uint128,uint128,uint128)' | num | paste -sd' ')"
log "smoke test OK"
