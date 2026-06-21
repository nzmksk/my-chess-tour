export type LoginState = {
  error: string | null;
  attemptsRemaining: number | null;
  locked: boolean;
  lockedSeconds: number | null;
  // Set when the password was correct but the account is unverified — the
  // client carries the user into the verification step instead of erroring.
  needsVerification?: boolean;
};

export const INITIAL_LOGIN_STATE: LoginState = {
  error: null,
  attemptsRemaining: null,
  locked: false,
  lockedSeconds: null,
};
