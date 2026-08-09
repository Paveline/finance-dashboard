#!/bin/bash
# Одноразовое создание личного аккаунта (запустить один раз на компьютере)
set -e
cd "$(dirname "$0")"

if [ ! -f config.js ]; then
  echo "Нет config.js"
  exit 1
fi

URL=$(node -e "const c=require('./config.js'); console.log(c.SUPABASE_CONFIG?.url||'')" 2>/dev/null || python3 -c "
import re
t=open('config.js').read()
print(re.search(r\"url:\\s*'([^']+)'\", t).group(1))
")
KEY=$(python3 -c "
import re
t=open('config.js').read()
print(re.search(r\"anonKey:\\s*'([^']+)'\", t).group(1))
")
EMAIL=$(python3 -c "
import re
t=open('config.js').read()
m=re.search(r\"ownerEmail:\\s*'([^']+)'\", t)
print(m.group(1) if m else '')
")

if [ -z "$EMAIL" ] || echo "$EMAIL" | grep -q YOUR_EMAIL; then
  echo "→ Сначала укажите ownerEmail в config.js"
  exit 1
fi

echo "Создание аккаунта: $EMAIL"
read -sp "Придумайте пароль (мин. 6 символов): " PASS
echo
read -sp "Повторите пароль: " PASS2
echo

if [ "$PASS" != "$PASS2" ]; then echo "Пароли не совпали"; exit 1; fi
if [ ${#PASS} -lt 6 ]; then echo "Пароль слишком короткий"; exit 1; fi

RESP=$(curl -s -w "\n%{http_code}" -X POST "${URL}/auth/v1/signup" \
  -H "apikey: ${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}")

BODY=$(echo "$RESP" | sed '$d')
CODE=$(echo "$RESP" | tail -1)

if [ "$CODE" = "200" ] || echo "$BODY" | grep -q '"access_token"'; then
  echo "✓ Аккаунт создан. Входите на сайте с этим паролем."
elif echo "$BODY" | grep -qi "already registered\|already exists\|User already registered"; then
  echo "→ Аккаунт уже существует. Просто войдите на сайте."
else
  echo "Ответ ($CODE): $BODY"
  echo ""
  echo "Если просит подтвердить email — в Supabase:"
  echo "  Authentication → Providers → Email → отключите Confirm email"
  echo "  Или: Authentication → Users → Add user → Auto Confirm User"
fi
