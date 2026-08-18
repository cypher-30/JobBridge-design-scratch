import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeStrings, dedupeEducation, dedupeRoles } from '../llm/parseCv.js';

describe('dedupeStrings', () => {
  test('removes case-insensitive duplicates, preserving first-seen casing', () => {
    const out = dedupeStrings(['Python', 'python', 'PYTHON', 'Django', 'django']);
    assert.deepEqual(out, ['Python', 'Django']);
  });

  test('drops empty/whitespace-only entries', () => {
    assert.deepEqual(dedupeStrings(['', '  ', 'Go']), ['Go']);
  });

  test('handles null/undefined input', () => {
    assert.deepEqual(dedupeStrings(undefined), []);
    assert.deepEqual(dedupeStrings(null), []);
  });
});

describe('dedupeEducation', () => {
  test('collapses entries identical up to case', () => {
    const out = dedupeEducation([
      { institution: 'University of Nairobi', degree: 'BSc', field: 'CS', year: '2024' },
      { institution: 'university of nairobi', degree: 'bsc', field: 'cs', year: '2024' },
    ]);
    assert.equal(out.length, 1);
  });

  test('drops fully-empty rows', () => {
    const out = dedupeEducation([{ institution: '', degree: '', field: '', year: '' }]);
    assert.equal(out.length, 0);
  });
});

describe('dedupeRoles', () => {
  test('merges duplicate roles and unions their highlights', () => {
    const out = dedupeRoles([
      { title: 'Intern', company: 'Acme', duration: '2024', highlights: ['Built X'] },
      { title: 'intern', company: 'acme', duration: '2024', highlights: ['Built X', 'Shipped Y'] },
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].highlights, ['Built X', 'Shipped Y']);
  });

  test('keeps roles with different duration as distinct', () => {
    const out = dedupeRoles([
      { title: 'Intern', company: 'Acme', duration: '2023', highlights: [] },
      { title: 'Intern', company: 'Acme', duration: '2024', highlights: [] },
    ]);
    assert.equal(out.length, 2);
  });
});
