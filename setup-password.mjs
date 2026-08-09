#!/usr/bin/env node
/**
 * Настройка и смена пароля (локально, один раз):
 *   node setup-password.mjs              — первичная настройка
 *   node setup-password.mjs --change     — сменить пароль (данные сохранятся)
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

async function deriveKey(password, saltB64, ops = ['encrypt']) {
  const salt = Buffer.from(saltB64, 'base64');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ops
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

async function decryptJSON(key, ciphertextB64) {
  const combined = Buffer.from(ciphertextB64, 'base64');
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12)
  );
  return JSON.parse(new TextDecoder().decode(dec));
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

async function askPassword(label) {
  const pass = await ask(`${label}: `, true);
  if (pass.length < 6) throw new Error('Пароль — минимум 6 символов');
  return pass;
}

async function fetchVault(api, anonKey) {
  const res = await fetch(`${api}/rest/v1/finance_vault?id=eq.${VAULT_ID}&select=salt,ciphertext`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  });
  if (!res.ok) throw new Error(`Supabase: ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function saveVault(api, anonKey, salt, ciphertext) {
  const res = await fetch(`${api}/rest/v1/finance_vault`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: VAULT_ID,
      salt,
      ciphertext,
      updated_at: new Date().toISOString()
    })
  });
  if (!res.ok) throw new Error(`Supabase: ${await res.text()}`);
}

async function setupInitial(api, anonKey) {
  const existing = await fetchVault(api, anonKey);
  if (existing) {
    console.log('→ Пароль уже настроен. Для смены: node setup-password.mjs --change');
    return;
  }

  const passArg = process.argv.includes('--change') ? null : process.argv[2];
  let pass, pass2;
  if (passArg) {
    pass = pass2 = passArg;
  } else {
    pass = await askPassword('Придумайте пароль (мин. 6 символов)');
    pass2 = await askPassword('Повторите пароль');
  }
  if (pass !== pass2) throw new Error('Пароли не совпали');

  const salt = randomSalt();
  const key = await deriveKey(pass, salt);
  const payload = { version: 3, updatedAt: new Date().toISOString(), projects: [], works: [], staff: [] };
  await saveVault(api, anonKey, salt, await encryptJSON(key, payload));
  console.log('✓ Пароль сохранён. Входите на сайте с этим паролем.');
}

async function changePassword(api, anonKey) {
  const existing = await fetchVault(api, anonKey);
  if (!existing) throw new Error('Хранилище не найдено. Сначала: node setup-password.mjs');

  const oldPass = await askPassword('Текущий пароль');
  const oldKey = await deriveKey(oldPass, existing.salt, ['decrypt']);
  let payload;
  try {
    payload = await decryptJSON(oldKey, existing.ciphertext);
  } catch {
    throw new Error('Неверный текущий пароль');
  }

  const newPass = await askPassword('Новый пароль');
  const newPass2 = await askPassword('Повторите новый пароль');
  if (newPass !== newPass2) throw new Error('Новые пароли не совпали');

  const salt = randomSalt();
  const newKey = await deriveKey(newPass, salt);
  await saveVault(api, anonKey, salt, await encryptJSON(newKey, payload));
  console.log('✓ Пароль изменён. Входите на сайте с новым паролем.');
}

async function main() {
  const { url, anonKey } = readConfig();
  const api = url.replace(/\/$/, '');
  const isChange = process.argv.includes('--change');

  if (isChange) await changePassword(api, anonKey);
  else await setupInitial(api, anonKey);
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
