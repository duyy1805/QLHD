const test = require('node:test');
const assert = require('node:assert/strict');
const { WORKFLOW_STATUS, deriveLeaveWorkflowState } = require('../utils/leaveWorkflowStatus');

const row = (RowGuid, SortOrder, JobTitleName) => ({ RowGuid, SortOrder, JobTitleName });

test('identifies new and returned sort-zero waiting rows as draft', () => {
    assert.deepEqual(deriveLeaveWorkflowState('W', [row('draft', 0, 'W')]), {
        WorkflowStatus: WORKFLOW_STATUS.DRAFT,
        SubmitProcessRowGuid: 'draft',
        SubmitSortOrder: 0,
    });
    assert.deepEqual(deriveLeaveWorkflowState('W', [row('old', 2, 'M'), row('returned', 0, 'W')]), {
        WorkflowStatus: WORKFLOW_STATUS.DRAFT,
        SubmitProcessRowGuid: 'returned',
        SubmitSortOrder: 0,
    });
});

test('keeps workflow pending while the highest active sort waits', () => {
    const state = deriveLeaveWorkflowState('Y', [
        row('requester', 0, 'Y'), row('manager', 1, 'Y'), row('director', 2, 'W'),
    ]);
    assert.equal(state.WorkflowStatus, WORKFLOW_STATUS.PENDING);
});

test('accepts any Y at the highest sort when approvers share a step', () => {
    const state = deriveLeaveWorkflowState('W', [
        row('requester', 0, 'Y'), row('approver-a', 1, 'W'), row('approver-b', 1, 'Y'),
    ]);
    assert.equal(state.WorkflowStatus, WORKFLOW_STATUS.APPROVED);
});

test('ignores M history when evaluating a resubmitted workflow', () => {
    const state = deriveLeaveWorkflowState('W', [
        row('old-requester', 0, 'M'), row('old-manager', 1, 'M'),
        row('new-requester', 0, 'Y'), row('new-manager', 2, 'W'),
    ]);
    assert.equal(state.WorkflowStatus, WORKFLOW_STATUS.PENDING);
});

test('keeps H unchanged and supports header fallbacks', () => {
    assert.equal(deriveLeaveWorkflowState('H', []).WorkflowStatus, null);
    assert.equal(deriveLeaveWorkflowState('Y', []).WorkflowStatus, WORKFLOW_STATUS.APPROVED);
    assert.equal(deriveLeaveWorkflowState('R', []).WorkflowStatus, WORKFLOW_STATUS.REJECTED);
});
