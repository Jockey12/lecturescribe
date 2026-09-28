import { PlatformColor } from 'react-native';

export const color = {
  accent: PlatformColor('controlAccentColor'),
  background: PlatformColor('windowBackgroundColor'),
  controlBackground: PlatformColor('controlBackgroundColor'),
  label: PlatformColor('labelColor'),
  secondaryLabel: PlatformColor('secondaryLabelColor'),
  separator: PlatformColor('separatorColor'),
  selectedContentBackground: PlatformColor('selectedContentBackgroundColor'),
  selectedText: PlatformColor('selectedTextColor'),
  tertiaryLabel: PlatformColor('tertiaryLabelColor'),
  textBackground: PlatformColor('textBackgroundColor'),
  unobtrusiveSelectedContentBackground: PlatformColor(
    'unemphasizedSelectedContentBackgroundColor',
  ),
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const type = {
  caption: 11,
  body: 13,
  title: 17,
  display: 28,
} as const;

export const radius = {
  control: 5,
  selection: 6,
} as const;

export const control = {
  compactHeight: 28,
  toolbarHeight: 48,
} as const;
