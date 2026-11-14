import '../docs/zod-extend.js';
import { z } from 'zod';

const lineControls = new Set(['\n', '\r', '\t']);

export function hasControlCharacter(value: string, multiline = false): boolean {
  return [...value].some((character) => {
    if (multiline && lineControls.has(character)) return false;
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export function boundedText(label: string, min: number, max: number, { multiline = false } = {}) {
  return z
    .string()
    .trim()
    .refine((value) => !hasControlCharacter(value, multiline), `${label} não pode ter caracteres de controle.`)
    .refine(
      (value) => [...value].length >= min && [...value].length <= max,
      `${label} precisa ter entre ${min} e ${max} caracteres.`,
    )
    .openapi({ maxLength: max });
}
