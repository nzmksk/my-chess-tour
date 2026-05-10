export type ForgotPasswordState = {
  error: string | null;
  submitted: boolean;
};

export const INITIAL_FORGOT_PASSWORD_STATE: ForgotPasswordState = {
  error: null,
  submitted: false,
};
