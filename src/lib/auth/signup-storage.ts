// Tab-scoped sessionStorage key for the in-progress signup form (email,
// password, profile fields). Owned by the signup multi-step context, and also
// seeded by login when it carries an unverified user into the verify step.
export const SIGNUP_FORM_STORAGE_KEY = "signup_form";
