import type { ConfigAction } from '../actions/config';
import type { Integrations, CmsConfig } from '../types/redux';
export declare function getIntegrations(config: CmsConfig): any;
declare function integrations(state: any, action: ConfigAction): Integrations | null;
export declare function selectIntegration(state: Integrations, collection: string | null, hook: string): any;
export default integrations;
