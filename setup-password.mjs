#!/usr/bin/env node
/**
 * Одноразовая настройка пароля (запустить один раз на компьютере):
 *   node setup-password.mjs
 */
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { webcrypto } from 'crypto';

const crypto = webcrypto;
const VAULT_ID = 'main';

function readConfig() {
  const text = readFileSync(new URL('./config.js', import.meta.url), 'utf8');
  const url = text.match(/url:\s*'([^']+)'/)?.[1];
  const anonKey = text.match(/anonKey:\s*'([^']+)'/)?.[1];
  if (!url || !anonKey) throw new Error('Заполните config.js');
  return { url, anonKey };
}

function bufToB64(buf) {
  return Buffer.from(buf).toString('base64');
}

function randomSalt() {
  return bufToB64(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveKey(password, saltB64) {
  const salt = Buffer.from(saltB64, 'base64');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
}

async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  return bufToB64(combined);
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) {
      rl.question(question, (a) => { rl.close(); resolve(a); });
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case '\n': case '\r': case '\u0004':
          stdin.pause();
          stdin.removeListener('data', onData);
          break;
        default:
          process.stdout.write('*');
          break;
      }
    };
    stdin.on('data', onData);
    rl.question('', (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

async function main() {
  const { url, anonKey } = readConfig();
  const api = url.replace(/\/$/, '');

  const check = await fetch(`${api}/rest/v1/finance_vault?id=eq.${VAULT_ID}&select=id`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  });
  const rows = await check.json();
  if (Array.isArray(rows) && rows.length > 0) {
    console.log('→ Пароль уже настроен. Просто войдите на сайте.');
    return;
  }

  const passArg = process.argv[2];
  let pass, pass2;
  if (passArg) {
    pass = pass2 = passArg;
  } else {
    pass = await ask('Придумайте пароль (мин. 6 символов): ', true);
    pass2 = await ask('Повторите пароль: ', true);
  }
  if (pass !== pass2) throw new Error('Пароли не совпали');
  if (pass.length < 6) throw new Error('Пароль — минимум 6 символов');

  const salt = randomSalt();
  const key = await deriveKey(pass, salt);
  const payload = { version: 3, updatedAt: new Date().toISOString(), projects: [], works: [], staff: [] };
  const ciphertext = await encryptJSON(key, payload);

  const res = await fetch(`${api}/rest/v1/finance_vault`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ id: VAULT_ID, salt, ciphertext, updated_at: new Date().toISOString() })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase: ${err}`);
  }

  console.log('✓ Пароль сохранён. Входите на сайте с этим паролем.');
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
