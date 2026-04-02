export interface DataLedgerState<TStat = unknown> {
  stats: TStat[];
  loading: boolean;
  error: string | null;
}

export type DataLedgerAction<TStat = unknown> =
  | { type: 'request_started' }
  | { type: 'request_succeeded'; stats: TStat[] }
  | { type: 'request_failed'; error: string };

export const createInitialDataLedgerState = <TStat = unknown>(): DataLedgerState<TStat> => ({
  stats: [],
  loading: true,
  error: null,
});

export const dataLedgerReducer = <TStat>(
  state: DataLedgerState<TStat>,
  action: DataLedgerAction<TStat>,
): DataLedgerState<TStat> => {
  switch (action.type) {
    case 'request_started':
      return {
        ...state,
        stats: [],
        loading: true,
        error: null,
      };
    case 'request_succeeded':
      return {
        stats: action.stats,
        loading: false,
        error: null,
      };
    case 'request_failed':
      return {
        ...state,
        loading: false,
        error: action.error,
      };
    default:
      return state;
  }
};
