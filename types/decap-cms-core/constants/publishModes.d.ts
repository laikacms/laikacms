export declare const SIMPLE = "simple";
export declare const EDITORIAL_WORKFLOW = "editorial_workflow";
export declare const Statues: {
    DRAFT: string;
    PENDING_REVIEW: string;
    PENDING_PUBLISH: string;
};
export declare const status: any;
export declare const statusDescriptions: any;
export type Status = keyof typeof Statues;
