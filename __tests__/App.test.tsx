/**
 * @format
 */

import React from 'react';
import {Text} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

const mockNote = {
  id: 'note-1',
  title: 'Biology lecture',
  createdAt: Date.now(),
  duration: 120,
  audioPath: '/tmp/lecture.m4a',
  status: 'complete' as const,
  transcript: 'Cells convert nutrients into energy.',
  source: 'recording' as const,
  summary: 'Cells need energy to perform their functions.',
  mainPoints: [
    'Cells convert nutrients into energy.',
    'Energy supports cellular functions.',
  ],
};

jest.mock('../src/LectureScribe', () => ({
  hasNativeLectureScribe: true,
  lectureScribe: {
    getNotes: jest.fn().mockResolvedValue([mockNote]),
    getModels: jest.fn().mockResolvedValue([]),
    getSummaryModels: jest.fn().mockResolvedValue([]),
  },
  lectureScribeEvents: null,
}));

const App = require('../App').default;

test('renders generated study points', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const studyPointsLabel = renderer!.root
    .findAllByType(Text)
    .find(text => text.props.children === 'Study Points');
  let studyPointsTab = studyPointsLabel?.parent;
  while (studyPointsTab && !studyPointsTab.props.onPress) {
    studyPointsTab = studyPointsTab.parent;
  }

  expect(studyPointsTab).toBeDefined();
  await ReactTestRenderer.act(async () => {
    studyPointsTab!.props.onPress();
  });

  const text = renderer!.root
    .findAllByType(Text)
    .map(element => React.Children.toArray(element.props.children).join(''))
    .join('\n');
  expect(text).toContain('• Cells convert nutrients into energy.');
  expect(text).toContain('• Energy supports cellular functions.');
});
