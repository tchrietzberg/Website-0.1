#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/src/web/public/audio"
mkdir -p "$out"

say() {
  local file="$1"
  local text="$2"
  if command -v edge-tts >/dev/null 2>&1; then
    local mp3="${file%.wav}.mp3"
    edge-tts --voice en-US-JennyNeural --rate=-8% --text "$text" --write-media "$mp3"
    ffmpeg -y -hide_banner -loglevel error -i "$mp3" -ar 24000 -ac 1 -acodec pcm_s16le "$file"
    rm -f "$mp3"
  elif command -v espeak-ng >/dev/null 2>&1; then
    espeak-ng -v en-us+f3 -s 145 -p 40 -w "$file" "$text"
  else
    echo "Need edge-tts or espeak-ng to generate $file" >&2
    exit 1
  fi
}

say "$out/intake-greeting.wav" "Hello, this is Chrono. I'm calling about a new matter."
cp "$out/intake-greeting.wav" "$out/intake-opening.wav"
say "$out/intake-name.wav" "May I have your full name, please?"
say "$out/intake-email.wav" "What is the best email address?"
say "$out/intake-matter.wav" "What should we name this matter or case?"
say "$out/intake-thanks.wav" "Thank you. I have everything I need. Goodbye."
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=2" -f lavfi -i "sine=frequency=480:duration=2" \
  -filter_complex "[0][1]amix=inputs=2:duration=longest,volume=0.35" \
  -ar 22050 -ac 1 "$out/intake-ringback.wav"
