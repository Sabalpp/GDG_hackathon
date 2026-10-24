import { z } from 'zod';
import { validateLayoutRequestSchema, layoutSchema, constraintFindingSchema } from './layouts.js';
import { costModificationSchema, costLineSchema, costEstimateSchema, modificationTypes } from './costs.js';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
export const budgetSchema = z.strictObject({
  currency: z.literal('USD'), max: z.number().finite().nonnegative().max(1_000_000_000),
});
export const generateProposalRequestSchema = validateLayoutRequestSchema.safeExtend({
  budget: budgetSchema.nullable().optional(),
}).refine(({ goals }) => goals.every((goal) => goal.status === 'confirmed'), 'Confirm all goals before generating proposals');
export const modificationSchema = costModificationSchema.extend({ type: z.enum(modificationTypes) });
export const pythonProposalSchema = z.strictObject({
  id, originalLayoutId: id, resultLayout: layoutSchema,
  modifications: z.array(modificationSchema).max(1000),
  findingsBefore: z.array(constraintFindingSchema).min(1).max(2000),
  findingsAfter: z.array(constraintFindingSchema).min(1).max(2000),
  costs: z.array(costLineSchema).max(1000),
  unresolvedQuestions: z.array(z.string().min(1).max(4000)).max(100),
});
export const pythonProposalResponseSchema = z.strictObject({
  proposals: z.array(pythonProposalSchema).min(1).max(10),
});
export const generateProposalResponseSchema = z.strictObject({
  proposals: z.array(pythonProposalSchema.extend({
    costEstimate: costEstimateSchema,
    unresolvedQuestions: z.array(z.string().min(1).max(4000)).max(2200),
  })).min(1).max(10),
});
export type GenerateProposalRequest = z.infer<typeof generateProposalRequestSchema>;
export type GenerateProposalResponse = z.infer<typeof generateProposalResponseSchema>;
