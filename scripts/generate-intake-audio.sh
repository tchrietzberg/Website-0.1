#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/src/web/public/audio"
mkdir -p "$out"
voice=(espeak-ng -v en-us+f3 -s 145 -p 40)
"${voice[@]}" -w "$out/intake-opening.wav" "This is Chrono calling about a new matter. May I have your full name?"
"${voice[@]}" -w "$out/intake-email.wav" "What is the best email address?"
"${voice[@]}" -w "$out/intake-matter.wav" "What should we name this matter or case?"
"${voice[@]}" -w "$out/intake-thanks.wav" "Thank you. I have everything I need. Goodbye."
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -f lavfi -i "sine=frequency=480:duration=2" \
  -filter_complex "[0][1]amix=inputs=2:duration=longest,volume=0.35" \
  -ar 22050 -ac 1 "$out/intake-ringback.wav"
