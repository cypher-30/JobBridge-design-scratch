import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inferEmploymentType } from '../ingestion/normalize.js';

describe('inferEmploymentType', () => {
  test('recognizes standard internship wording', () => {
    assert.equal(inferEmploymentType({ title: 'Software Engineering Intern' }), 'internship');
  });

  test('recognizes Kenyan "attachment" vocabulary', () => {
    assert.equal(inferEmploymentType({ title: 'Industrial Attachment - Backend' }), 'internship');
    assert.equal(inferEmploymentType({ title: 'IT Attachee' }), 'internship');
  });

  test('recognizes graduate trainee / apprentice / trainee', () => {
    assert.equal(inferEmploymentType({ title: 'Graduate Trainee Program' }), 'internship');
    assert.equal(inferEmploymentType({ title: 'Software Apprentice' }), 'internship');
    assert.equal(inferEmploymentType({ title: 'Trainee Developer' }), 'internship');
  });

  test('recognizes contract/freelance/temporary', () => {
    assert.equal(inferEmploymentType({ title: 'Backend Engineer', commitment: 'Contract' }), 'contract');
    assert.equal(inferEmploymentType({ title: 'Freelance Designer' }), 'contract');
  });

  test('defaults to full-time when no commitment signal present', () => {
    assert.equal(inferEmploymentType({ title: 'Backend Engineer' }), 'full-time');
  });

  test('SmartRecruiters typeOfEmployment.label feeds through as commitment', () => {
    assert.equal(inferEmploymentType({ title: 'Data Ops Consultant', commitment: 'Contract' }), 'contract');
    assert.equal(inferEmploymentType({ title: 'AI Engineer', commitment: 'Full-time' }), 'full-time');
  });
});
