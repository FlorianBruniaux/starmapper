#!/usr/bin/env bash
# banner-reminder.sh
# PostToolUse: remind to update AnnouncementBanner when a new page or route is created.

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // empty')

# Only trigger on Write (new file creation), not Edit
[[ "$TOOL" != "Write" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.parameters.file_path // empty')
[[ -z "$FILE_PATH" ]] && exit 0

# Only care about new pages and API routes
if echo "$FILE_PATH" | grep -qE 'src/app/(.*)/page\.tsx$|src/app/api/(.*)/route\.ts$'; then
  # Skip if it's the banner component itself
  if echo "$FILE_PATH" | grep -q "announcement-banner"; then
    exit 0
  fi

  RELATIVE="${FILE_PATH#*/src/app/}"

  cat << EOF
{
  "systemMessage": "💬 Nouvelle page/route créée : src/app/$RELATIVE\n→ Pense à mettre à jour l'AnnouncementBanner si c'est une feature à annoncer.\n   Fichier : src/components/announcement-banner.tsx\n   Bump BANNER_ID pour que le bandeau réapparaisse pour les visiteurs existants."
}
EOF
fi

exit 0