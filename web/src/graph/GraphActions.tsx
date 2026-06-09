import { createContext, useContext } from "react";

export interface GraphActions {
  editable: boolean;
  onInspect: (id: string) => void;
  onDisable: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  // Extended in Plan 3b Task 4 (inline add / edge insert):
  onRequestAdd: (fromId: string, at: { x: number; y: number }) => void;
  onRequestInsert: (edgeId: string, at: { x: number; y: number }) => void;
}

const noop = () => {};
export const GraphActionsContext = createContext<GraphActions>({
  editable: false,
  onInspect: noop,
  onDisable: noop,
  onDuplicate: noop,
  onDelete: noop,
  onRequestAdd: noop,
  onRequestInsert: noop,
});

export const useGraphActions = () => useContext(GraphActionsContext);
