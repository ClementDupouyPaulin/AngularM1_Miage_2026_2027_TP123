#!/usr/bin/env node
// Hook PostToolUse : journalise factuellement chaque fichier modifié par
// l'assistant dans RAPPORT_IA_MODELE.md, section "## Journal automatique
// des modifications". Ne touche jamais aux autres sections du fichier.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Racine du dépôt déduite de l'emplacement du script (.claude/hooks/ → ../..) :
// aucun chemin personnel en dur, le hook fonctionne sur n'importe quel clone.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORT_PATH = resolve(REPO_ROOT, 'RAPPORT_IA_MODELE.md');
const SECTION_HEADER = '## Journal automatique des modifications';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function extractFilePath(input) {
  const ti = input.tool_input || {};
  const tr = input.tool_response || {};
  return ti.file_path || ti.path || tr.filePath || null;
}

function main() {
  const raw = readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const toolName = payload.tool_name;
  if (!toolName) return;

  const filePath = extractFilePath(payload);
  if (!filePath) return;

  const absPath = isAbsolute(filePath) ? filePath : resolve(REPO_ROOT, filePath);
  const rel = relative(REPO_ROOT, absPath);

  // Hors repo -> on ignore
  if (rel.startsWith('..') || isAbsolute(rel)) return;

  // Évite la boucle : ne jamais journaliser une modification du rapport lui-même
  if (resolve(REPO_ROOT, rel) === REPORT_PATH) return;

  if (!existsSync(REPORT_PATH)) return;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const line = `- [${timestamp}] ${toolName} — ${rel}`;

  let content = readFileSync(REPORT_PATH, 'utf8');

  if (content.includes(SECTION_HEADER)) {
    // Ajoute la ligne à la fin du fichier si la section existe déjà en fin
    // de document, sinon juste après l'en-tête de section.
    if (content.trimEnd().endsWith(line)) return; // évite les doublons stricts consécutifs
    content = content.replace(/\s*$/, '') + '\n' + line + '\n';
  } else {
    content = content.replace(/\s*$/, '') + `\n\n${SECTION_HEADER}\n\n` + line + '\n';
  }

  writeFileSync(REPORT_PATH, content, 'utf8');
}

main();
