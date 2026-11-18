// The address players and organizers are told to write to when they need a
// person. One constant so the copy in the app cannot drift apart again: the
// login lockout screen once sent people to an old Gmail inbox while every other
// page named this one.
//
// The email templates under src/services/email/templates are static HTML and
// hard-code it; templates.test.ts fails if one of them names anything else.
export const SUPPORT_EMAIL = "support@mychesstour.com";
