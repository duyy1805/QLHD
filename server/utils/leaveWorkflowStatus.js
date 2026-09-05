const WORKFLOW_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
});

function normalize(value) {
    return String(value ?? '').trim().toUpperCase();
}

function deriveLeaveWorkflowState(headerStatus, processRows = []) {
    const activeRows = processRows.filter((row) => normalize(row.JobTitleName) !== 'M');
    const waitingDraft = activeRows.find(
        (row) => normalize(row.JobTitleName) === 'W' && Number(row.SortOrder) === 0
    );

    if (activeRows.length > 0) {
        const maxSortOrder = Math.max(...activeRows.map((row) => Number(row.SortOrder) || 0));
        const finalStepApproved = activeRows.some(
            (row) => Number(row.SortOrder) === maxSortOrder && normalize(row.JobTitleName) === 'Y'
        );
        const hasApprovedStep = activeRows.some((row) => normalize(row.JobTitleName) === 'Y');
        const hasWaitingStep = activeRows.some((row) => normalize(row.JobTitleName) === 'W');

        if (finalStepApproved) {
            return result(WORKFLOW_STATUS.APPROVED);
        }

        if (hasApprovedStep || (hasWaitingStep && !waitingDraft)) {
            return result(WORKFLOW_STATUS.PENDING);
        }

        if (waitingDraft) {
            return result(WORKFLOW_STATUS.DRAFT, waitingDraft.RowGuid, Number(waitingDraft.SortOrder));
        }
    }

    const normalizedHeaderStatus = normalize(headerStatus);
    if (normalizedHeaderStatus === 'Y') return result(WORKFLOW_STATUS.APPROVED);
    if (normalizedHeaderStatus === 'R') return result(WORKFLOW_STATUS.REJECTED);
    if (normalizedHeaderStatus === 'H') return result(null);

    return result(
        processRows.some((row) => normalize(row.JobTitleName) === 'M')
            ? WORKFLOW_STATUS.REJECTED
            : WORKFLOW_STATUS.DRAFT
    );
}

function result(WorkflowStatus, SubmitProcessRowGuid = null, SubmitSortOrder = null) {
    return { WorkflowStatus, SubmitProcessRowGuid, SubmitSortOrder };
}

module.exports = { WORKFLOW_STATUS, deriveLeaveWorkflowState };
