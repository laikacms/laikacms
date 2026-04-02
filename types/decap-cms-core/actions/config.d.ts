import type { ThunkDispatch } from 'redux-thunk';
import type { AnyAction } from 'redux';
import type { CmsCollection, CmsConfig, CmsI18nConfig, CmsPublishMode, CmsLocalBackend, State } from '../types/redux';
export declare const CONFIG_REQUEST = "CONFIG_REQUEST";
export declare const CONFIG_SUCCESS = "CONFIG_SUCCESS";
export declare const CONFIG_FAILURE = "CONFIG_FAILURE";
export declare function normalizeConfig(config: CmsConfig): {
    collections: CmsCollection[];
    backend: import("../types/redux").CmsBackend;
    locale?: string;
    site_url?: string;
    display_url?: string;
    logo_url?: string;
    logo?: {
        src: string;
        show_in_header?: boolean;
    };
    show_preview_links?: boolean;
    media_folder?: string;
    public_folder?: string;
    media_folder_relative?: boolean;
    media_library?: import("../types/redux").CmsMediaLibrary;
    publish_mode?: CmsPublishMode;
    load_config_file?: boolean;
    integrations?: {
        hooks: string[];
        provider: string;
        collections?: "*" | string[];
        applicationID?: string;
        apiKey?: string;
        getSignedFormURL?: string;
    }[];
    slug?: import("../types/redux").CmsSlug;
    i18n?: CmsI18nConfig;
    local_backend?: boolean | CmsLocalBackend;
    editor?: {
        preview?: boolean;
    };
    error: string | undefined;
    isFetching: boolean;
};
export declare function applyDefaults(originalConfig: CmsConfig): any;
export declare function parseConfig(data: string): Partial<CmsConfig>;
export declare function configLoaded(config: CmsConfig): {
    readonly type: "CONFIG_SUCCESS";
    readonly payload: CmsConfig;
};
export declare function configLoading(): {
    readonly type: "CONFIG_REQUEST";
};
export declare function configFailed(err: Error): {
    readonly type: "CONFIG_FAILURE";
    readonly error: "Error loading config";
    readonly payload: Error;
};
export declare function detectProxyServer(localBackend?: boolean | CmsLocalBackend): Promise<{
    proxyUrl?: undefined;
    publish_modes?: undefined;
    type?: undefined;
} | {
    proxyUrl: string;
    publish_modes: CmsPublishMode[];
    type: string;
}>;
export declare function handleLocalBackend(originalConfig: CmsConfig): Promise<any>;
export declare function loadConfig(manualConfig: Partial<CmsConfig>, onLoad: () => unknown): {
    readonly type: "CONFIG_SUCCESS";
    readonly payload: CmsConfig;
} | ((dispatch: ThunkDispatch<State, ThunkContext, AnyAction>) => Promise<void>);
export type ConfigAction = ReturnType<typeof configLoading | typeof configLoaded | typeof configFailed>;
