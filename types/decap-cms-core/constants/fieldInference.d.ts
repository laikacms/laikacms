import React from 'react';
export declare const IDENTIFIER_FIELDS: readonly ["title", "path"];
export declare const SORTABLE_FIELDS: readonly ["title", "date", "author", "description"];
export declare const INFERABLE_FIELDS: {
    title: {
        type: string;
        secondaryTypes: any[];
        synonyms: string[];
        defaultPreview: (value: React.ReactNode) => any;
        fallbackToFirstField: boolean;
        showError: boolean;
    };
    shortTitle: {
        type: string;
        secondaryTypes: any[];
        synonyms: string[];
        defaultPreview: (value: React.ReactNode) => any;
        fallbackToFirstField: boolean;
        showError: boolean;
    };
    author: {
        type: string;
        secondaryTypes: any[];
        synonyms: string[];
        defaultPreview: (value: React.ReactNode) => any;
        fallbackToFirstField: boolean;
        showError: boolean;
    };
    date: {
        type: string;
        secondaryTypes: string[];
        synonyms: string[];
        defaultPreview: (value: React.ReactNode) => React.ReactNode;
        fallbackToFirstField: boolean;
        showError: boolean;
    };
    description: {
        type: string;
        secondaryTypes: string[];
        synonyms: string[];
        defaultPreview: (value: React.ReactNode) => React.ReactNode;
        fallbackToFirstField: boolean;
        showError: boolean;
    };
    image: {
        type: string;
        secondaryTypes: any[];
        synonyms: string[];
        defaultPreview: (value: React.ReactNode) => React.ReactNode;
        fallbackToFirstField: boolean;
        showError: boolean;
    };
};
