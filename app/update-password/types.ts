export type UpdatePasswordState = {
  error: string | null;
  fieldErrors: {
    password?: string;
    confirmPassword?: string;
  };
};

export const INITIAL_UPDATE_PASSWORD_STATE: UpdatePasswordState = {
  error: null,
  fieldErrors: {},
};
