import type { resultFlags } from '../database/schema/exam-results.js';
import { MINUTE } from '../lib/time.js';
import type { ResultInput, Worklist } from '../modules/lab-integration/lab-integration.model.js';

type Random = () => number;
type Content = Pick<ResultInput, 'items'> | Pick<ResultInput, 'report'>;

interface Analyte {
  name: string;
  unit: string;
  decimals: number;
  min: number;
  max: number;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

interface Finding {
  normal: string;
  altered: string;
  impression: string;
}

type Model = { kind: 'lab'; analytes: Analyte[] } | { kind: 'imaging'; title: string; findings: Finding[] };

const ALTERED_CHANCE = 0.2;
const AMENDMENT_NOTE = 'Adendo: laudo revisado pelo médico responsável, sem mudança na impressão diagnóstica.';

const models: Record<string, Model> = {
  hemograma: {
    kind: 'lab',
    analytes: [
      { name: 'Hemoglobina', unit: 'g/dL', decimals: 1, min: 10.5, max: 17, low: 12, high: 16, criticalLow: 7 },
      { name: 'Hematócrito', unit: '%', decimals: 1, min: 32, max: 50, low: 36, high: 46, criticalLow: 20 },
      {
        name: 'Leucócitos',
        unit: '/mm³',
        decimals: 0,
        min: 3000,
        max: 13000,
        low: 4000,
        high: 11000,
        criticalLow: 2000,
        criticalHigh: 30000,
      },
      {
        name: 'Plaquetas',
        unit: '/mm³',
        decimals: 0,
        min: 120000,
        max: 480000,
        low: 150000,
        high: 450000,
        criticalLow: 50000,
      },
    ],
  },
  glicemia: {
    kind: 'lab',
    analytes: [
      {
        name: 'Glicose em jejum',
        unit: 'mg/dL',
        decimals: 0,
        min: 45,
        max: 130,
        low: 70,
        high: 99,
        criticalLow: 50,
        criticalHigh: 400,
      },
    ],
  },
  colesterol: {
    kind: 'lab',
    analytes: [
      { name: 'Colesterol total', unit: 'mg/dL', decimals: 0, min: 140, max: 240, high: 189 },
      { name: 'HDL', unit: 'mg/dL', decimals: 0, min: 30, max: 75, low: 40 },
      { name: 'LDL', unit: 'mg/dL', decimals: 0, min: 70, max: 170, high: 129 },
      { name: 'Triglicerídeos', unit: 'mg/dL', decimals: 0, min: 70, max: 220, high: 149, criticalHigh: 1000 },
    ],
  },
  ultrassom: {
    kind: 'imaging',
    title: 'ULTRASSONOGRAFIA DE ABDOME TOTAL',
    findings: [
      {
        normal: 'Fígado de dimensões normais, contornos regulares e ecotextura homogênea.',
        altered: 'Fígado de dimensões normais, com aumento difuso da ecogenicidade.',
        impression: 'esteatose hepática leve',
      },
      {
        normal: 'Vesícula biliar normodistendida, de paredes finas, sem cálculos.',
        altered: 'Vesícula biliar com imagem ecogênica móvel de 0,8 cm, com sombra acústica posterior.',
        impression: 'colelitíase',
      },
      {
        normal: 'Rins de forma, dimensões e ecogenicidade normais, sem dilatação das vias excretoras.',
        altered: 'Rim direito com imagem anecoica de paredes finas, medindo 1,5 cm.',
        impression: 'cisto renal simples à direita',
      },
      {
        normal: 'Baço e pâncreas sem alterações.',
        altered: 'Baço discretamente aumentado, com 13,5 cm no maior eixo.',
        impression: 'esplenomegalia discreta',
      },
    ],
  },
  raio_x: {
    kind: 'imaging',
    title: 'RADIOGRAFIA DE TÓRAX (PA E PERFIL)',
    findings: [
      {
        normal: 'Campos pulmonares sem opacidades.',
        altered: 'Opacidade focal no lobo inferior direito.',
        impression: 'opacidade em base direita, a correlacionar com a clínica',
      },
      {
        normal: 'Seios costofrênicos livres.',
        altered: 'Velamento do seio costofrênico esquerdo.',
        impression: 'pequeno derrame pleural à esquerda',
      },
      {
        normal: 'Área cardíaca dentro dos limites da normalidade.',
        altered: 'Índice cardiotorácico aumentado.',
        impression: 'aumento da área cardíaca',
      },
      {
        normal: 'Estruturas ósseas sem alterações.',
        altered: 'Osteófitos marginais em corpos vertebrais torácicos.',
        impression: 'alterações degenerativas da coluna torácica',
      },
    ],
  },
};

function seededRandom(seed: string): Random {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ (char.codePointAt(0) ?? 0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const formatNumber = (value: number, decimals: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function referenceRangeOf({ low, high, decimals }: Analyte): string {
  if (low !== undefined && high !== undefined) {
    return `${formatNumber(low, decimals)} a ${formatNumber(high, decimals)}`;
  }
  if (high !== undefined) return `até ${formatNumber(high, decimals)}`;
  return `acima de ${formatNumber(low ?? 0, decimals)}`;
}

export function flagOf(analyte: Analyte, value: number): (typeof resultFlags)[number] {
  const { low, high, criticalLow, criticalHigh } = analyte;
  if ((criticalLow !== undefined && value < criticalLow) || (criticalHigh !== undefined && value > criticalHigh)) {
    return 'critical';
  }
  if (low !== undefined && value < low) return 'low';
  if (high !== undefined && value > high) return 'high';
  return 'normal';
}

function itemOf(analyte: Analyte, value: number) {
  return {
    name: analyte.name,
    value,
    unit: analyte.unit,
    referenceRange: referenceRangeOf(analyte),
    flag: flagOf(analyte, value),
  };
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

function contentsOf(model: Model, random: Random): { content: Content; amended: Content } {
  if (model.kind === 'lab') {
    const values = model.analytes.map((analyte) =>
      round(analyte.min + random() * (analyte.max - analyte.min), analyte.decimals),
    );
    const itemsOf = (bump: number) =>
      model.analytes.map((analyte, index) =>
        itemOf(
          analyte,
          round((values[index] ?? 0) + (index === 0 ? bump : 0) / 10 ** analyte.decimals, analyte.decimals),
        ),
      );
    return { content: { items: itemsOf(0) }, amended: { items: itemsOf(1) } };
  }
  const altered = model.findings.filter(() => random() < ALTERED_CHANCE);
  const lines = model.findings.map((finding) => `- ${altered.includes(finding) ? finding.altered : finding.normal}`);
  const impression = altered.length
    ? altered.map((finding) => finding.impression).join('; ')
    : 'exame dentro dos limites da normalidade';
  const report = [model.title, '', 'Achados:', ...lines, '', `Impressão: ${impression}.`].join('\n');
  return { content: { report }, amended: { report: `${report}\n\n${AMENDMENT_NOTE}` } };
}

interface Simulation {
  result: ResultInput;
  amendment?: ResultInput;
}

export function simulationOf(
  { examCode, examTypeCode, startsAt }: Worklist[number],
  now: Date,
  amendChance: number,
): Simulation | undefined {
  const model = models[examTypeCode];
  if (!model) return undefined;
  const random = seededRandom(examCode);
  const delay = (60 + Math.floor(random() * 180)) * MINUTE;
  const issuedAt = new Date(Math.min(Date.parse(startsAt) + delay, now.getTime())).toISOString();
  const { content, amended } = contentsOf(model, random);
  const result: ResultInput = { externalId: `SIM-${examCode}`, examCode, status: 'final', issuedAt, ...content };
  if (seededRandom(`${examCode}:amend`)() >= amendChance) return { result };
  return { result, amendment: { ...result, status: 'amended', issuedAt: now.toISOString(), ...amended } };
}
