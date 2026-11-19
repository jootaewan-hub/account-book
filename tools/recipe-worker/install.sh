#!/usr/bin/env bash
# 레시피 처리기 설치: install.sh <커밋>
# 그 커밋의 tools/recipe-worker 와 supabase/functions/_shared/recipe*.ts 를 설치 폴더에 같은 상대 배치로 꺼내고,
# 의존성 설치(npm ci), ocr 만들기, 설정 견본 쓰기, launchd plist 두기까지 한다.
# launchctl 은 부르지 않는다(불러오기는 사용자가 따로 한다). 비밀은 만들지도 보여 주지도 않는다.
#
# 폴더는 환경변수로 바꿀 수 있다(시험용):
#   RECIPE_WORKER_HOME        설치 폴더        (기본 ~/Library/Application Support/recipe-worker)
#   RECIPE_WORKER_AGENTS_DIR  plist 를 둘 폴더 (기본 ~/Library/LaunchAgents)
#   RECIPE_WORKER_CONFIG_DIR  설정 폴더        (기본 ~/.config/recipe-worker)
#   RECIPE_WORKER_LOG_DIR     로그 폴더        (기본 ~/Library/Logs/recipe-worker)
#   RECIPE_WORKER_LABEL       launchd 이름     (기본 local.recipe-worker)
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "사용법: install.sh <커밋>" >&2
  exit 2
fi

HOME_DIR="${RECIPE_WORKER_HOME:-$HOME/Library/Application Support/recipe-worker}"
AGENTS_DIR="${RECIPE_WORKER_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
CONFIG_DIR="${RECIPE_WORKER_CONFIG_DIR:-$HOME/.config/recipe-worker}"
LOG_DIR="${RECIPE_WORKER_LOG_DIR:-$HOME/Library/Logs/recipe-worker}"
LABEL="${RECIPE_WORKER_LABEL:-local.recipe-worker}"

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
if ! COMMIT="$(git -C "$REPO" rev-parse --verify --quiet "$1^{commit}")"; then
  echo "커밋을 찾을 수 없어요: $1" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node 를 찾을 수 없어요. Node 25 이상을 먼저 설치해 주세요(brew install node)." >&2
  exit 1
fi
NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 25 ]; then
  echo "Node 25 이상이 필요해요(지금 $NODE_MAJOR)" >&2
  exit 1
fi
SWIFTC=/usr/bin/swiftc
[ -x "$SWIFTC" ] || { echo "swiftc 를 찾을 수 없어요(xcode-select --install)" >&2; exit 1; }

# 지우기 전에 경로가 안전한지 본다(비었거나, /, $HOME, 절대 경로가 아니면 지우지 않는다)
safe_rm() {
  local p="$1"
  case "$p" in
    ''|'/'|"$HOME"|"$HOME/") echo "지우면 안 되는 경로예요: '$p'" >&2; exit 1 ;;
    /*) ;;
    *) echo "절대 경로가 아니에요: '$p'" >&2; exit 1 ;;
  esac
  rm -rf -- "$p"
}
case "$HOME_DIR" in
  ''|'/'|"$HOME"|"$HOME/") echo "설치 폴더가 올바르지 않아요: '$HOME_DIR'" >&2; exit 1 ;;
  /*) ;;
  *) echo "설치 폴더는 절대 경로여야 해요: '$HOME_DIR'" >&2; exit 1 ;;
esac
HOME_DIR="${HOME_DIR%/}"

mkdir -p "$(dirname "$HOME_DIR")" "$AGENTS_DIR" "$LOG_DIR" "$CONFIG_DIR/bin" "$CONFIG_DIR/models"
chmod 700 "$CONFIG_DIR"

# 새 사본은 설치 폴더와 같은 곳(같은 파일 시스템)의 임시 폴더에서 끝까지 만들고, 마지막에 이름 바꾸기로 바꾼다.
# 어느 단계든 실패하면 지금 쓰는 설치는 그대로 남는다.
STAGE="$(mktemp -d "$(dirname "$HOME_DIR")/.recipe-worker-stage.XXXXXX")"
OCR_NEW="$CONFIG_DIR/bin/.ocr.new.$$"
PLIST_NEW=""
cleanup() {
  [ -n "${STAGE:-}" ] && safe_rm "$STAGE"
  rm -f -- "$OCR_NEW"
  [ -n "${PLIST_NEW:-}" ] && rm -f -- "$PLIST_NEW"
  return 0
}
trap cleanup EXIT

# 1. 그 커밋의 파일만 꺼낸다(작업 폴더의 파일은 쓰지 않는다)
git -C "$REPO" archive "$COMMIT" -- tools/recipe-worker/package.json tools/recipe-worker/package-lock.json tools/recipe-worker/src 'supabase/functions/_shared/recipe*.ts' | tar -x -C "$STAGE"
for f in tools/recipe-worker/package.json tools/recipe-worker/package-lock.json tools/recipe-worker/src/cli.ts; do
  [ -e "$STAGE/$f" ] || { echo "그 커밋에 $f 가 없어요" >&2; exit 1; }
done
cp "$STAGE/tools/recipe-worker/package.json" "$STAGE/package.json"
cp "$STAGE/tools/recipe-worker/package-lock.json" "$STAGE/package-lock.json"

# 2. 의존성(배포용만). 두 폴더 모두 맨 위 node_modules 의 zod 를 쓴다
(cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund)

# 3. 화면 글자 읽는 도구(설정 폴더 안에 임시 이름으로 만들어 둔다)
"$SWIFTC" -O -o "$OCR_NEW" "$STAGE/tools/recipe-worker/src/collect/ocr.swift"

# 4. plist (claude 가 있는 폴더를 PATH 에 더한다). 새 사본의 launchd.ts 로 만든다
CLAUDE_DIR="$HOME/.local/bin"
if CLAUDE_BIN="$(command -v claude 2>/dev/null)"; then CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"; fi
PLIST="$AGENTS_DIR/$LABEL.plist"
PLIST_NEW="$PLIST.tmp.$$"
LAUNCHD_MODULE="file://$STAGE/tools/recipe-worker/src/launchd.ts" LABEL="$LABEL" NODE="$NODE" SCRIPT="$HOME_DIR/tools/recipe-worker/src/cli.ts" LOGDIR="$LOG_DIR" CLAUDE_DIR="$CLAUDE_DIR" \
  "$NODE" --input-type=module -e "
const { renderPlist } = await import(process.env.LAUNCHD_MODULE)
const e = process.env
process.stdout.write(renderPlist({ label: e.LABEL, node: e.NODE, script: e.SCRIPT, logDir: e.LOGDIR, extraPath: [e.CLAUDE_DIR] }))
" > "$PLIST_NEW"
chmod 644 "$PLIST_NEW"
if command -v plutil >/dev/null 2>&1; then plutil -lint "$PLIST_NEW" >/dev/null; fi

# 5. 다 만들었다. 맨 마지막에 커밋 이름을 적고 이름 바꾸기 두 번으로 바꾼다
printf '%s\n' "$COMMIT" > "$STAGE/COMMIT"
OLD="$HOME_DIR.old"
safe_rm "$OLD"
if [ -e "$HOME_DIR" ]; then mv -- "$HOME_DIR" "$OLD"; fi
if ! mv -- "$STAGE" "$HOME_DIR"; then
  echo "새 사본으로 바꾸지 못해 이전 설치를 되돌려요" >&2
  if [ -e "$OLD" ]; then mv -- "$OLD" "$HOME_DIR"; fi
  exit 1
fi
STAGE=""
safe_rm "$OLD"
mv -f -- "$OCR_NEW" "$CONFIG_DIR/bin/ocr"
mv -f -- "$PLIST_NEW" "$PLIST"
PLIST_NEW=""

# 5. 설정 견본(값 없음). 설정 파일은 없을 때만 견본에서 만든다. 비밀 파일은 만들지 않는다
cat > "$CONFIG_DIR/config.example.json" <<'JSON'
{
  "endpoint": "https://YOUR-PROJECT.example.invalid/functions/v1/recipe-worker",
  "secretFile": "~/.config/recipe-worker/secret",
  "cacheDir": "~/Library/Caches/recipe-worker",
  "claudePath": "~/.local/bin/claude",
  "ytDlpPath": "/opt/homebrew/bin/yt-dlp",
  "ytDlpExtraArgs": [],
  "ffmpegPath": "/opt/homebrew/bin/ffmpeg",
  "whisperCliPath": "/opt/homebrew/bin/whisper-cli",
  "whisperModel": "~/.config/recipe-worker/models/ggml-large-v3-turbo.bin",
  "ocrPath": "~/.config/recipe-worker/bin/ocr",
  "onHours": [["08:30", "18:20"], ["20:00", "06:30"]],
  "dailyLimit": 15,
  "obsidianDir": null,
  "driveTokenFile": null
}
JSON
if [ ! -e "$CONFIG_DIR/config.json" ]; then
  cp "$CONFIG_DIR/config.example.json" "$CONFIG_DIR/config.json"
  CONFIG_NEW=1
else
  CONFIG_NEW=0
fi

echo "설치했어요: $COMMIT"
echo "  설치 폴더: $HOME_DIR"
echo "  plist: $PLIST (아직 불러오지 않았어요)"
if [ "$CONFIG_NEW" = 1 ]; then
  echo "  설정 파일을 견본으로 만들었어요: $CONFIG_DIR/config.json (endpoint 등을 채워 주세요)"
else
  echo "  설정 파일은 그대로 뒀어요: $CONFIG_DIR/config.json"
fi
echo "  비밀 파일($CONFIG_DIR/secret)은 직접 만들고 chmod 600 으로 바꿔 주세요."
echo "  점검: $NODE $HOME_DIR/tools/recipe-worker/src/cli.ts doctor"
