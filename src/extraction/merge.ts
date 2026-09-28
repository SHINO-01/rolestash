import type {
  ExtractedFields,
  ExtractionResult,
  FieldKey,
  FieldValue,
  StrategyOutput,
} from './types';

/**
 * Field-level merge: for each field keep the candidate with the highest
 * confidence. Ties go to the earlier strategy (strategies are ordered by
 * trust), so JSON-LD beats an equally-confident selector.
 */
export function mergeOutputs(outputs: readonly StrategyOutput[]): {
  fields: Partial<ExtractedFields>;
  provenance: ExtractionResult['provenance'];
} {
  const best = new Map<FieldKey, FieldValue>();
  for (const output of outputs) {
    for (const [key, candidate] of Object.entries(output) as [FieldKey, FieldValue][]) {
      const current = best.get(key);
      if (!current || candidate.confidence > current.confidence) best.set(key, candidate);
    }
  }
  const fields: Partial<Record<FieldKey, unknown>> = {};
  const provenance: ExtractionResult['provenance'] = {};
  for (const [key, candidate] of best) {
    fields[key] = candidate.value;
    provenance[key] = { strategy: candidate.strategy, confidence: candidate.confidence };
  }
  return { fields: fields as Partial<ExtractedFields>, provenance };
}

/** Weights for the overall score; the fields users care most about dominate. */
const WEIGHTS: Partial<Record<FieldKey, number>> = {
  title: 0.4,
  company: 0.3,
  location: 0.15,
  description: 0.15,
};

export function overallConfidence(provenance: ExtractionResult['provenance']): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS) as [FieldKey, number][]) {
    score += weight * (provenance[key]?.confidence ?? 0);
  }
  return Math.round(score * 100) / 100;
}
