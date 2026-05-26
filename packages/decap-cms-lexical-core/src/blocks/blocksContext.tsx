import { createContext, type ReactNode, useContext } from 'react';

import type { BlocksConfig } from './types';

const BlocksContext = createContext<BlocksConfig>({});

/** Supplies block configuration (editor components, asset resolver) to the tree. */
export function BlocksProvider(props: { value: BlocksConfig, children: ReactNode }): ReactNode {
  return <BlocksContext.Provider value={props.value}>{props.children}</BlocksContext.Provider>;
}

/** Access the current {@link BlocksConfig}. */
export function useBlocksConfig(): BlocksConfig {
  return useContext(BlocksContext);
}
