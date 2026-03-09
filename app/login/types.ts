export type LoginState = {
  error: string | null;
  attemptsRemaining: number | null;
  locked: boolean;
  lockedSeconds: number | null;
};

export const INITIAL_LOGIN_STATE: LoginState = {
  error: null,
  attemptsRemaining: null,
  locked: false,
  lockedSeconds: null,
};
