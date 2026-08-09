#!/bin/bash
set -e
cd "$(dirname "$0")"

GH="${GH_BIN:-/tmp/gh_2.63.2_macOS_arm64/bin/gh}"

if [ ! -x "$GH" ]; then
  echo "Скачиваю GitHub CLI..."
  curl -sL https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_macOS_arm64.zip -o /tmp/gh.zip
  unzip -oq /tmp/gh.zip -d /tmp
  GH="/tmp/gh_2.63.2_macOS_arm64/bin/gh"
fi

if ! "$GH" auth status &>/dev/null; then
  echo "→ Откроется браузер для входа в GitHub..."
  "$GH" auth login --web --git-protocol https
fi

USER=$("$GH" api user --jq .login)
echo "→ GitHub: $USER"

git push -u origin main 2>/dev/null || git push origin main

"$GH" api repos/"$USER"/finance-dashboard/pages -X POST \
  -f source[branch]=main -f source[path]=/ 2>/dev/null \
  || "$GH" repo edit "$USER/finance-dashboard" --enable-pages --pages-branch main --pages-path /
echo ""
echo "✓ Готово! Сайт будет доступен через 1–2 минуты:"
echo "  https://$USER.github.io/finance-dashboard/"
