#!/bin/zsh
# Pomiar jednego przebiegu generowania wideo na tej maszynie.
#
# Mierzymy trzy rzeczy osobno, bo mówią co innego:
#  - czas całkowity (tyle czeka grafik),
#  - czas samego liczenia (tyle zajmie przy ciepłym modelu),
#  - szczyt pamięci (czy w ogóle mieści się obok modelu obrazu).
#
# Throttling termiczny czytamy z `pmset -g thermlog` — jeżeli procesor został
# przydławiony, czas przestaje być porównywalny między przebiegami.
D=/private/tmp/claude-501/-Users-kamilkmiec-work/3119b0d2-938e-4bdd-926b-38f1701fcb83/scratchpad
W=$D/wagi/FastMetal-5B-QAD
OUT=$D/wideo-out
mkdir -p $OUT

NAZWA=$1; H=$2; SZER=$3; KLATKI=$4; shift 4

echo "── $NAZWA: ${SZER}×${H}, ${KLATKI} klatek ──"

# Szczyt pamięci systemowej próbkujemy w tle: MLX raportuje swój szczyt sam,
# ale interesuje nas też, ile zostaje reszcie systemu.
SZCZYT_PLIK=$OUT/$NAZWA.szczyt
( SZCZYT=0
  while :; do
    U=$(vm_stat | awk '/Pages free/{gsub(/\./,"",$3);f=$3} /Pages speculative/{gsub(/\./,"",$3);s=$3} END{printf "%.0f", (2097152-f-s)*16384/1048576}')
    [ "$U" -gt "$SZCZYT" ] 2>/dev/null && { SZCZYT=$U; echo $SZCZYT > $SZCZYT_PLIK; }
    sleep 1
  done ) &
PROBKA=$!

START=$(date +%s)
$D/wideo/bin/python spike/mlx_wan22_generate.py \
  --mlx-checkpoint $W --dit-config $W/mlx_dit.json \
  --text-encoder-root $W --vae-root $W/vae \
  --height $H --width $SZER --num-frames $KLATKI --fps 24 --seed 7 \
  --output-path $OUT/$NAZWA.mp4 \
  --metrics-json $OUT/$NAZWA.metryki.json "$@" > $OUT/$NAZWA.log 2>&1
KOD=$?
KONIEC=$(date +%s)
kill $PROBKA 2>/dev/null

echo "  wynik: $([ $KOD -eq 0 ] && echo OK || echo "BŁĄD (kod $KOD)")"
echo "  czas całkowity: $((KONIEC-START)) s"
[ -f $OUT/$NAZWA.szczyt ] && echo "  szczyt pamięci systemu: $(( $(cat $OUT/$NAZWA.szczyt) / 1024 )) GB"
[ -f $OUT/$NAZWA.mp4 ] && echo "  plik: $(stat -f%z $OUT/$NAZWA.mp4 | awk '{printf "%.1f", $1/1048576}') MB"
[ -f $OUT/$NAZWA.metryki.json ] && python3 -c "
import json,sys
m=json.load(open('$OUT/$NAZWA.metryki.json'))
for k,v in m.items():
    if isinstance(v,(int,float,str)): print(f'  {k}: {v}')
" 2>/dev/null
grep -oiE "peak.{0,30}(memory|mem).{0,20}" $OUT/$NAZWA.log | tail -2 | sed 's/^/  /'
