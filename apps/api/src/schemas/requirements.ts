import { z } from 'zod';

// No shared contracts exist yet; export these types for API consumers.
export const interpretRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(8000),
});

export const goalDescriptions = {
  step_free_access: 'Explore step-free access options.',
  easier_circulation: 'Explore easier movement through the home.',
  bathroom_access: 'Explore more accessible bathroom use.',
  kitchen_access: 'Explore more accessible kitchen use.',
  easier_reach: 'Explore easier access to frequently used items and controls.',
  transfer_support: 'Explore support for transfers and changes in position.',
  visibility: 'Explore improved lighting and visual contrast.',
  sensory_support: 'Explore support for sensory or communication needs.',
  fall_risk_reduction: 'Explore ways to reduce trip and fall hazards.',
} as const;

export const questionDescriptions = {
  mobility: 'What mobility aids or assistance do you use, and for which activities?',
  rooms: 'Which rooms or routes should the redesign address?',
  measurements: 'Can you provide verified room, doorway, and mobility-device measurements?',
  budget: 'What budget and renovation constraints should be considered?',
  priorities: 'Which daily activities are most difficult, and which changes matter most?',
} as const;

export const draftGoalSchema = z.strictObject({
  category: z.enum(Object.keys(goalDescriptions) as [keyof typeof goalDescriptions, ...Array<keyof typeof goalDescriptions>]),
  priority: z.enum(['high', 'medium', 'low']),
  room: z.enum(['entrance', 'hallway', 'bathroom', 'kitchen', 'bedroom', 'living_room', 'stairs']).nullable(),
});

// Only enumerated values cross the model boundary. Free-form model prose is
// deliberately excluded so it cannot introduce dimensions or compliance claims.
export const modelInterpretationSchema = z.strictObject({
  goals: z.array(draftGoalSchema).max(12),
  missingInformation: z.array(z.enum(Object.keys(questionDescriptions) as [keyof typeof questionDescriptions, ...Array<keyof typeof questionDescriptions>])).max(5),
});

export const interpretResponseSchema = z.strictObject({
  status: z.literal('draft'),
  goals: z.array(draftGoalSchema.extend({ description: z.string() })).max(12),
  questions: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type InterpretRequest = z.infer<typeof interpretRequestSchema>;
export type InterpretResponse = z.infer<typeof interpretResponseSchema>;
