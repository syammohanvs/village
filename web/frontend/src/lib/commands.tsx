import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CommandResponse, Mode } from '../types';
import { ApiError, api, errorMessage } from './api';
import { useDemo } from './demo';

export type CommandStatus = 'pending' | 'confirmed' | 'rejected' | 'duplicate' | 'unconfirmed';

export interface CommandLogEntry {
  id: string;
  at: Date;
  type: string;
  parameters: Record<string, unknown>;
  source: 'browser' | 'voice' | 'system';
  mode: Mode;
  status: CommandStatus;
  result?: string;
  reason?: string;
  reasonCode?: string;
  errorCode?: string;
}

export interface CommandOutcome {
  ok: boolean;
  status: CommandStatus;
  reason?: string;
  reasonCode?: string;
  entry: CommandLogEntry;
  response?: CommandResponse;
  error?: unknown;
}

export interface CommandsContextValue {
  entries: CommandLogEntry[];
  send: (
    type: string,
    parameters?: Record<string, unknown>,
    source?: 'browser' | 'voice' | 'system',
  ) => Promise<CommandOutcome>;
  clear: () => void;
}

const CommandsContext = createContext<CommandsContextValue | null>(null);

export function CommandsProvider({ children }: { children: ReactNode }) {
  const { mode } = useDemo();
  const [entries, setEntries] = useState<CommandLogEntry[]>([]);
  const counter = useRef(0);

  const send = useCallback<CommandsContextValue['send']>(
    async (type, parameters = {}, source = 'browser') => {
      counter.current += 1;
      const id = `cmd-${counter.current}`;
      const entry: CommandLogEntry = {
        id,
        at: new Date(),
        type,
        parameters,
        source,
        mode,
        status: 'pending',
      };
      setEntries((previous) => [entry, ...previous].slice(0, 60));

      const update = (patch: Partial<CommandLogEntry>) => {
        setEntries((previous) =>
          previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        );
      };

      try {
        const response = await api.sendCommand({ type, parameters, source, mode });
        let status: CommandStatus;
        if (!response.confirmed) {
          status = 'unconfirmed';
        } else if (response.ack?.result === 'REJECTED') {
          status = 'rejected';
        } else if (response.ack?.result === 'DUPLICATE' || response.duplicate_request) {
          status = 'duplicate';
        } else {
          status = 'confirmed';
        }
        const reason = response.ack?.reason ?? response.error?.message;
        const reasonCode = response.ack?.reason_code ?? response.error?.code;
        update({
          status,
          result: response.ack?.result,
          reason,
          reasonCode,
          errorCode: response.error?.code,
        });
        return {
          ok: status === 'confirmed' || status === 'duplicate',
          status,
          reason,
          reasonCode,
          entry,
          response,
        };
      } catch (cause) {
        const isApi = cause instanceof ApiError;
        const reason = errorMessage(cause);
        const status: CommandStatus = 'unconfirmed';
        update({
          status,
          reason,
          reasonCode: isApi ? cause.code : 'UNCONFIRMED',
          errorCode: isApi ? cause.code : 'UNCONFIRMED',
        });
        return {
          ok: false,
          status,
          reason,
          reasonCode: isApi ? cause.code : 'UNCONFIRMED',
          entry,
          error: cause,
        };
      }
    },
    [mode],
  );

  const value = useMemo<CommandsContextValue>(
    () => ({ entries, send, clear: () => setEntries([]) }),
    [entries, send],
  );

  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>;
}

export function useCommands(): CommandsContextValue {
  const value = useContext(CommandsContext);
  if (!value) throw new Error('useCommands must be used inside CommandsProvider');
  return value;
}
