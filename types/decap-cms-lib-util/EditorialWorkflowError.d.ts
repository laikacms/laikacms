export declare const EDITORIAL_WORKFLOW_ERROR = "EDITORIAL_WORKFLOW_ERROR";
export default class EditorialWorkflowError extends Error {
    message: string;
    notUnderEditorialWorkflow: boolean;
    constructor(message: string, notUnderEditorialWorkflow: boolean);
}
