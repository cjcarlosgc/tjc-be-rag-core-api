export type GenerationMode =
  | 'TARGET'
  | 'CLASS_ALL'
  | 'CLASS_MISSING'
  | 'PROJECT_MISSING'
  | 'PROJECT_ALL';

export const GENERATION_MODES: GenerationMode[] = [
  'TARGET',
  'CLASS_ALL',
  'CLASS_MISSING',
  'PROJECT_MISSING',
  'PROJECT_ALL',
];
