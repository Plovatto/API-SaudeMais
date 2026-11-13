import { z } from 'zod';

export function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export function boundedText(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .refine((value) => !hasControlCharacter(value), `${label} não pode ter caracteres de controle.`)
    .refine(
      (value) => [...value].length >= min && [...value].length <= max,
      `${label} precisa ter entre ${min} e ${max} caracteres.`,
    );
}
