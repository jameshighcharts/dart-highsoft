export const LOCATIONS = [
  { value: 'bergen', label: 'Bergen' },
  { value: 'vik', label: 'Vik' },
  { value: 'sogndal', label: 'Sogndal' },
] as const;

export type LocationValue = (typeof LOCATIONS)[number]['value'];
